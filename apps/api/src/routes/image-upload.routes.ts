/**
 * image-upload.routes.ts
 *
 * POST /images/upload
 * Reçoit un fichier image en multipart/form-data.
 * Upload sur Cloudinary (si configuré), sinon stockage disque local.
 * Déclenche l'analyse IA de l'image et retourne le résultat + l'URL publique.
 *
 * Réponse : { url, cloudinary_public_id?, analysis? }
 */

import { FastifyInstance } from 'fastify';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { v2 as cloudinary } from 'cloudinary';
import { ImageAnalysisService } from '../services/image-analysis.service';
import { COLLECTIONS } from '../config/collections.js';

export const UPLOADS_DIR =
  process.env.UPLOADS_DIR ?? path.join(process.cwd(), 'uploads');

const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic', '.heif']);
const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024; // 15 Mo

function isCloudinaryConfigured(): boolean {
  return !!(
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
  );
}

function configureCloudinary() {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key:    process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

/** Upload un Buffer sur Cloudinary, retourne l'URL sécurisée et le public_id */
async function uploadToCloudinary(
  buffer: Buffer,
  guideId: string,
  ext: string
): Promise<{ url: string; public_id: string }> {
  configureCloudinary();
  return new Promise((resolve, reject) => {
    const folder = `redactor-guide/${guideId}`;
    // HEIC/HEIF → toujours convertir en JPEG via Cloudinary
    const isHeic = ['.heic', '.heif'].includes(ext.toLowerCase());
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: 'image',
        format: isHeic ? 'jpg' : ext.replace('.', ''),
        use_filename: false,
        unique_filename: true,
      },
      (err, result) => {
        if (err || !result) return reject(err ?? new Error('Cloudinary: résultat vide'));
        resolve({ url: result.secure_url, public_id: result.public_id });
      }
    );
    const readable = new Readable();
    readable.push(buffer);
    readable.push(null);
    readable.pipe(uploadStream);
  });
}

export async function imageUploadRoutes(fastify: FastifyInstance) {
  const db = fastify.container.db;

  /**
   * POST /images/upload
   * Corps : multipart/form-data
   *   - file     : fichier image (obligatoire)
   *   - guide_id : identifiant du guide (query param)
   *
   * Réponse :
   * {
   *   url: string,
   *   cloudinary_public_id?: string,
   *   analysis?: {
   *     editorial_relevance, visual_clarity_score, composition_quality_score,
   *     lighting_quality_score, readability_small_screen_score,
   *     is_iconic_view, shows_entire_site, shows_detail, detail_type,
   *     is_contextual, is_composite, has_text_overlay, has_graphic_effects,
   *     analysis_summary
   *   }
   * }
   */
  fastify.post<{
    Querystring: { guide_id?: string };
  }>('/images/upload', async (request, reply) => {
    const data = await request.file({ limits: { fileSize: MAX_FILE_SIZE_BYTES } });

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

    // Lire tout le fichier en mémoire (nécessaire pour Cloudinary + analyse)
    const chunks: Buffer[] = [];
    for await (const chunk of data.file) {
      chunks.push(chunk as Buffer);
    }
    const buffer = Buffer.concat(chunks);

    let publicUrl: string;
    let cloudinaryPublicId: string | undefined;

    if (isCloudinaryConfigured()) {
      // ── Upload Cloudinary ────────────────────────────────────────────────────
      try {
        const result = await uploadToCloudinary(buffer, guideId, originalExt);
        publicUrl         = result.url;
        cloudinaryPublicId = result.public_id;
        fastify.log.info(`☁️ Image uploadée sur Cloudinary : ${publicUrl}`);
      } catch (err) {
        fastify.log.error(err, 'Erreur upload Cloudinary');
        return reply.status(500).send({ error: 'Erreur lors de l\'upload Cloudinary' });
      }
    } else {
      // ── Fallback stockage local ──────────────────────────────────────────────
      const uuid     = crypto.randomUUID();
      const filename = `${uuid}${originalExt}`;
      const destDir  = path.join(UPLOADS_DIR, guideId);
      const destPath = path.join(destDir, filename);

      fs.mkdirSync(destDir, { recursive: true });

      try {
        await pipeline(Readable.from(buffer), fs.createWriteStream(destPath));
      } catch (err) {
        fs.rmSync(destPath, { force: true });
        fastify.log.error(err, 'Erreur écriture fichier uploadé');
        return reply.status(500).send({ error: 'Erreur lors de la sauvegarde du fichier' });
      }

      const apiBase = process.env.API_PUBLIC_URL?.replace(/\/$/, '') ?? '';
      publicUrl = `${apiBase}/uploads/${guideId}/${filename}`;
      fastify.log.info(`📁 Image uploadée en local : ${publicUrl}`);
    }

    // ── Analyse IA de l'image ────────────────────────────────────────────────
    let analysis: Record<string, any> | undefined;

    const openaiApiKey = process.env.OPENAI_API_KEY;
    const promptDoc = openaiApiKey
      ? await db.collection(COLLECTIONS.prompts).findOne({
          $or: [
            { prompt_id: 'analyse_image', actif: true },
            { intent: 'analyse_image',    actif: true },
          ],
        })
      : null;

    if (openaiApiKey && promptDoc) {
      try {
        const imageAnalysisService = new ImageAnalysisService(openaiApiKey, db);
        const analyses = await imageAnalysisService.analyzeImages(
          [publicUrl],
          promptDoc.texte_prompt as string
        );
        if (analyses.length > 0) {
          analysis = analyses[0].analysis as Record<string, any>;
          fastify.log.info(`🔍 Analyse IA terminée pour ${publicUrl}`);
        }
      } catch (err) {
        fastify.log.warn(err, 'Analyse IA échouée — image uploadée sans analyse');
      }
    } else {
      fastify.log.info('ℹ️ Analyse IA ignorée (OPENAI_API_KEY ou prompt manquant)');
    }

    return reply.status(201).send({
      url: publicUrl,
      ...(cloudinaryPublicId ? { cloudinary_public_id: cloudinaryPublicId } : {}),
      ...(analysis ? { analysis } : {}),
    });
  });
}
