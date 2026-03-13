import { FastifyInstance } from 'fastify';
import OpenAI from 'openai';
import { PerplexityService } from '../services/perplexity.service.js';

export async function workflowRoutes(fastify: FastifyInstance) {
  /**
   * POST /workflow/validate
   * Valide une liste de candidats pour un champ via Perplexity Sonar.
   * Le prompt est déjà rendu (variables substituées) côté frontend.
   * Retourne : { validated, uncertain, rejected, grounding_sources }
   */
  fastify.post('/workflow/validate', async (request, reply) => {
    const { rendered_prompt } = request.body as { rendered_prompt: string };
    if (!rendered_prompt?.trim()) {
      return reply.code(400).send({ error: 'rendered_prompt requis' });
    }

    const perplexityApiKey = process.env.PERPLEXITY_API_KEY;
    if (!perplexityApiKey) {
      return reply.code(503).send({ error: 'PERPLEXITY_API_KEY non configurée' });
    }

    const perplexity = new PerplexityService(perplexityApiKey, 'sonar');
    const result = await perplexity.verifyElements(rendered_prompt);
    return reply.send(result);
  });

  /**
   * POST /workflow/rewrite
   * Réécrit les éléments validés via OpenAI.
   * Le prompt est déjà rendu (variables substituées) côté frontend.
   * Retourne : { rewritten: string[] }
   */
  fastify.post('/workflow/rewrite', async (request, reply) => {
    const { rendered_prompt } = request.body as { rendered_prompt: string };
    if (!rendered_prompt?.trim()) {
      return reply.code(400).send({ error: 'rendered_prompt requis' });
    }

    const openaiApiKey = process.env.OPENAI_API_KEY;
    if (!openaiApiKey) {
      return reply.code(503).send({ error: 'OPENAI_API_KEY non configurée' });
    }

    const client = new OpenAI({ apiKey: openaiApiKey });
    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            'You are a controlled rewriting agent. Return STRICT JSON: { "rewritten": ["element1", "element2", ...] }. Each item in the array corresponds to one rewritten validated element. Do not add or remove elements.',
        },
        { role: 'user', content: rendered_prompt },
      ],
      temperature: 0.2,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error('Pas de réponse OpenAI');

    const parsed = JSON.parse(content);
    // Normaliser le format de sortie
    const rewritten: string[] = Array.isArray(parsed.rewritten)
      ? parsed.rewritten
      : Array.isArray(parsed.elements)
      ? parsed.elements
      : Object.values(parsed).find(Array.isArray) as string[] ?? [];

    return reply.send({ rewritten });
  });
}
