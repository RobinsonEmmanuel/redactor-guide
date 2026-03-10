import { FastifyInstance } from 'fastify';
import { ObjectId } from 'mongodb';
import { COLLECTIONS } from '../config/collections.js';

// Lazy-initialize the Drive client to avoid startup crashes when the env var is absent
function buildDriveClient() {
  const credJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!credJson) return null;
  try {
    const { google } = require('googleapis');
    const credentials = JSON.parse(credJson);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    });
    return google.drive({ version: 'v3', auth });
  } catch (err) {
    console.error('❌ [Drive] Erreur initialisation client Google Drive:', err);
    return null;
  }
}

export default async function driveImagesRoutes(fastify: FastifyInstance) {
  const db = fastify.mongo.db!;

  /**
   * GET /guides/:guideId/drive-images
   * Liste les fichiers image dans le dossier Google Drive configuré pour le guide.
   */
  fastify.get<{ Params: { guideId: string } }>(
    '/guides/:guideId/drive-images',
    async (request, reply) => {
      const { guideId } = request.params;

      let guide: any;
      try {
        guide = await db.collection(COLLECTIONS.guides).findOne({ _id: new ObjectId(guideId) });
      } catch {
        return reply.code(400).send({ error: 'ID de guide invalide' });
      }
      if (!guide) return reply.code(404).send({ error: 'Guide non trouvé' });

      const folderId: string | undefined = guide.google_drive_folder_id;
      if (!folderId) {
        return reply.code(400).send({
          error: 'Aucun dossier Google Drive configuré pour ce guide',
          hint: 'Renseignez google_drive_folder_id dans le Paramétrage du guide.',
        });
      }

      const drive = buildDriveClient();
      if (!drive) {
        return reply.code(503).send({
          error: 'Google Drive non disponible',
          hint: 'La variable GOOGLE_SERVICE_ACCOUNT_JSON est absente ou invalide sur le serveur.',
        });
      }

      try {
        const DRIVE_OPTS = { supportsAllDrives: true, includeItemsFromAllDrives: true };

        // Helper : liste les images directes d'un dossier
        const listImages = async (parentId: string, folderName?: string) => {
          const res = await drive.files.list({
            q: `'${parentId}' in parents and mimeType contains 'image/' and trashed = false`,
            fields: 'files(id, name, mimeType, thumbnailLink, size, createdTime, imageMediaMetadata)',
            pageSize: 300,
            orderBy: 'name',
            ...DRIVE_OPTS,
          });
          return (res.data.files ?? []).map((f: any) => ({
            id: f.id,
            name: f.name,
            mimeType: f.mimeType,
            thumbnailLink: f.thumbnailLink ?? null,
            size: f.size ? parseInt(f.size, 10) : null,
            createdTime: f.createdTime ?? null,
            folder: folderName ?? null,
          }));
        };

        // 1. Images directes à la racine
        const rootImages = await listImages(folderId);

        // 2. Sous-dossiers directs
        const subRes = await drive.files.list({
          q: `'${folderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
          fields: 'files(id, name)',
          pageSize: 200,
          orderBy: 'name',
          ...DRIVE_OPTS,
        });
        const subFolders: Array<{ id: string; name: string }> = subRes.data.files ?? [];

        // 3. Images dans chaque sous-dossier (1 niveau de profondeur)
        const subImages = (
          await Promise.all(subFolders.map((sf: any) => listImages(sf.id, sf.name)))
        ).flat();

        const allFiles = [...rootImages, ...subImages];
        console.log(`📁 [Drive] ${allFiles.length} fichier(s) trouvé(s) (${subFolders.length} sous-dossier(s)) dans ${folderId}`);

        return reply.send({ files: allFiles, total: allFiles.length });
      } catch (err: any) {
        console.error('❌ [Drive] Erreur liste fichiers:', err?.message ?? err);
        return reply.code(500).send({
          error: 'Erreur lors de la lecture du dossier Google Drive',
          details: err?.message,
        });
      }
    }
  );

  /**
   * POST /guides/:guideId/drive-images/:fileId/import
   * Télécharge un fichier depuis Google Drive et l'upload vers Cloudinary (ou stockage local).
   * Supporte les fichiers HEIC/HEIF — Cloudinary les convertit automatiquement en JPEG.
   */
  fastify.post<{ Params: { guideId: string; fileId: string } }>(
    '/guides/:guideId/drive-images/:fileId/import',
    async (request, reply) => {
      const { guideId, fileId } = request.params;

      let guide: any;
      try {
        guide = await db.collection(COLLECTIONS.guides).findOne({ _id: new ObjectId(guideId) });
      } catch {
        return reply.code(400).send({ error: 'ID de guide invalide' });
      }
      if (!guide) return reply.code(404).send({ error: 'Guide non trouvé' });

      const drive = buildDriveClient();
      if (!drive) {
        return reply.code(503).send({ error: 'Google Drive non disponible' });
      }

      try {
        // Récupérer les métadonnées du fichier
        const metaRes = await drive.files.get({ fileId, fields: 'name,mimeType', supportsAllDrives: true });
        const fileName: string = metaRes.data.name ?? fileId;

        // Télécharger le contenu binaire
        const contentRes = await drive.files.get(
          { fileId, alt: 'media', supportsAllDrives: true },
          { responseType: 'arraybuffer' }
        );
        const buffer = Buffer.from(contentRes.data as ArrayBuffer);

        console.log(`⬇️ [Drive] Fichier téléchargé : ${fileName} (${buffer.length} octets)`);

        // Upload vers Cloudinary si configuré, sinon stockage local
        const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
        const cloudApiKey = process.env.CLOUDINARY_API_KEY;
        const cloudApiSecret = process.env.CLOUDINARY_API_SECRET;

        if (cloudName && cloudApiKey && cloudApiSecret) {
          const { v2: cloudinary } = await import('cloudinary');
          cloudinary.config({
            cloud_name: cloudName,
            api_key: cloudApiKey,
            api_secret: cloudApiSecret,
          });

          const url = await new Promise<string>((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream(
              {
                folder: `redactor-guide/${guideId}`,
                resource_type: 'image',
                // Force la conversion en JPEG (couvre HEIC, HEIF, etc.)
                format: 'jpg',
                public_id: `drive_${Date.now()}_${fileName.replace(/[^a-zA-Z0-9]/g, '_')}`,
              },
              (error, result) => {
                if (error) reject(error);
                else resolve(result!.secure_url);
              }
            );
            stream.end(buffer);
          });

          console.log(`☁️ [Drive→Cloudinary] ${fileName} → ${url}`);
          return reply.send({ url, fileName });
        } else {
          // Stockage local fallback
          const path = await import('path');
          const fs = await import('fs/promises');
          const { UPLOADS_DIR } = await import('./image-upload.routes.js');

          const dir = path.join(UPLOADS_DIR, guideId);
          await fs.mkdir(dir, { recursive: true });

          const safeName = fileName
            .replace(/[^a-zA-Z0-9._-]/g, '_')
            .replace(/\.(heic|heif)$/i, '.jpg');
          const uniqueName = `drive_${Date.now()}_${safeName}`;
          const filePath = path.join(dir, uniqueName);
          await fs.writeFile(filePath, buffer);

          const apiPublicUrl = process.env.API_PUBLIC_URL ?? 'http://localhost:3000';
          const url = `${apiPublicUrl}/uploads/${guideId}/${uniqueName}`;

          console.log(`💾 [Drive→Local] ${fileName} → ${url}`);
          return reply.send({ url, fileName });
        }
      } catch (err: any) {
        console.error('❌ [Drive] Erreur import fichier:', err?.message ?? err);
        return reply.code(500).send({
          error: 'Erreur lors de l\'import depuis Google Drive',
          details: err?.message,
        });
      }
    }
  );
}
