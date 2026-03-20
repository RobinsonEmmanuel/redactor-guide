/**
 * Script diagnostic : vérifie si un article est présent en base articles_raw
 * Usage: npx tsx scripts/check-article.ts <url>
 */
import { MongoClient } from 'mongodb';

const MONGODB_URI = 'mongodb+srv://travmatter:MlojoS4FzEb4Ob7u@internalrl.pqxqt94.mongodb.net/?retryWrites=true&w=majority&appName=InternalRL';
const DB_NAME = 'redactor_guide';

async function main() {
  const rawUrl = process.argv[2] ?? 'https://canarias-lovers.com/que-faire-candelaraia-tenrife-visiter/';

  const hashIdx = rawUrl.indexOf('#');
  const baseUrl = hashIdx !== -1 ? rawUrl.slice(0, hashIdx) : rawUrl;
  const urlWithSlash    = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
  const urlWithoutSlash = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;

  console.log(`\n🔍 Recherche de l'article pour URL : ${baseUrl}`);
  console.log(`   Variante avec slash    : ${urlWithSlash}`);
  console.log(`   Variante sans slash    : ${urlWithoutSlash}\n`);

  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db(DB_NAME);

  // Chercher avec toutes les variantes
  const urlVariants = [urlWithSlash, urlWithoutSlash];
  const article = await db.collection('articles_raw').findOne({
    $or: urlVariants.flatMap(u => [
      { 'urls_by_lang.fr': u },
      { 'urls_by_lang.en': u },
      { 'urls_by_lang.de': u },
      { 'urls_by_lang.es': u },
      { 'urls_by_lang.it': u },
      { url: u },
    ]),
  }, { projection: { title: 1, url: 1, urls_by_lang: 1, slug: 1, categories: 1, analyzed_images: 1, _id: 1 } });

  if (!article) {
    console.log('❌ Article INTROUVABLE en base\n');

    // Chercher par slug (partie URL après le domaine)
    const slug = baseUrl.replace(/https?:\/\/[^/]+\//, '').replace(/\/$/, '');
    console.log(`   Recherche par slug partiel : "${slug}"`);
    const bySlug = await db.collection('articles_raw').findOne(
      { slug: { $regex: slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
      { projection: { title: 1, url: 1, urls_by_lang: 1, slug: 1 } }
    );
    if (bySlug) {
      console.log(`⚠️ Trouvé par slug : "${bySlug.title}"`);
      console.log(`   urls_by_lang :`, bySlug.urls_by_lang);
      console.log(`   url          :`, bySlug.url);
    } else {
      console.log('   Rien trouvé par slug non plus.\n');

      // Chercher tous les articles du domaine canarias-lovers.com
      console.log('   Articles du domaine canarias-lovers.com en base :');
      const domainArticles = await db.collection('articles_raw').find(
        {
          $or: [
            { 'urls_by_lang.fr': { $regex: 'canarias-lovers', $options: 'i' } },
            { url: { $regex: 'canarias-lovers', $options: 'i' } },
          ]
        },
        { projection: { title: 1, 'urls_by_lang.fr': 1, url: 1 } }
      ).limit(20).toArray();

      if (domainArticles.length === 0) {
        console.log('   → Aucun article de canarias-lovers.com n\'est ingéré en base !');
      } else {
        domainArticles.forEach((a, i) => {
          console.log(`   ${i + 1}. "${a.title}" → ${a.urls_by_lang?.fr ?? a.url ?? '(pas d\'URL FR)'}`);
        });
      }
    }
  } else {
    console.log(`✅ Article trouvé : "${article.title}"`);
    console.log(`   _id           : ${article._id}`);
    console.log(`   urls_by_lang  :`, article.urls_by_lang);
    console.log(`   url           :`, article.url);
    console.log(`   slug          :`, article.slug);
    console.log(`   categories    :`, article.categories);
    const imgCount = (article.analyzed_images ?? []).length;
    console.log(`   images analy. : ${imgCount} image(s)`);
  }

  await client.close();
}

main().catch(console.error);
