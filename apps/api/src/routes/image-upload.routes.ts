/**
 * image-upload.routes.ts
 *
 * Route POST /images/upload
 * Reçoit un fichier image en multipart/form-data, le stocke sur le disque
 * dans le répertoire UPLOADS_DIR et retourne une URL publique accessible.
 *
 * Cette URL est stockée dans MongoDB comme n'importe quelle autre URL d'image.
 * resolveImagesForGuide la téléchargera lors de la génération du ZIP InDesign.
 *
 * Stockage : <UPLOADS_DIR>/<guideId>/<uuid>.<ext>
 * URL      : <API_PUBLIC_URL>/uploads/<guideId>/<uuid>.<ext>
 */

import { FastifyInstance } from 'fastify';
import { pipeline } from 'stream/promises';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

// Répertoire de stockage — peut être surchargé via la variable d'env UPLOADS_DIR
export const UPLOADS_DIR =
  process.env.UPLOADS_DIR ?? path.join(process.cwd(), 'uploads');

// Extensions acceptées (sécurité basique)
const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024; // 15 Mo

export async function imageUploadRoutes(fastify: FastifyInstance) {
  /**
   * POST /images/upload
   * Corps : multipart/form-data
   *   - file  : le fichier image (obligatoire)
   *   - guide_id : identifiant du guide (optionnel, utilisé pour organiser le dossier)
   *
   * Réponse :
   *   { url: "https://…/uploads/guideId/uuid.jpg", filename: "uuid.jpg" }
   */
  fastify.post<{
    Querystring: { guide_id?: string };
  }>('/images/upload', async (request, reply) => {
    const data = await request.file({
      limits: { fileSize: MAX_FILE_SIZE_BYTES },
    });

    if (!data) {
      return reply.status(400).send({ error: 'Aucun fichier reçu' });
    }

    const originalExt = path.extname(data.filename).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(originalExt)) {
      return reply.status(415).send({
        error: `Format non supporté : ${originalExt}. Formats acceptés : jpg, png, webp, gif`,
      });
    }

    const guideId = (request.query as any).guide_id ?? 'misc';
    const uuid    = crypto.randomUUID();
    const filename = `${uuid}${originalExt}`;

    const destDir  = path.join(UPLOADS_DIR, guideId);
    const destPath = path.join(destDir, filename);

    fs.mkdirSync(destDir, { recursive: true });

    try {
      await pipeline(data.file, fs.createWriteStream(destPath));
    } catch (err) {
      fs.rmSync(destPath, { force: true });
      fastify.log.error(err, 'Erreur écriture fichier uploadé');
      return reply.status(500).send({ error: 'Erreur lors de la sauvegarde du fichier' });
    }

    // Construire l'URL publique
    const apiBase = process.env.API_PUBLIC_URL?.replace(/\/$/, '') ?? '';
    const url = `${apiBase}/uploads/${guideId}/${filename}`;

    fastify.log.info(`Image uploadée : ${url} (${data.mimetype})`);

    return reply.status(201).send({ url, filename });
  });
}
