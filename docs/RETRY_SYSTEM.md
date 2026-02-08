# Système de Retry avec Validation

Ce document décrit le système de retry automatique lors de la génération de contenu IA.

## Vue d'ensemble

Lorsqu'une page est générée par l'IA, le système valide automatiquement le contenu selon les règles définies dans le template. Si la validation échoue, le système effectue jusqu'à **3 tentatives** pour corriger les erreurs.

## Flux de génération

```
┌─────────────────────────────────────┐
│  1. Génération initiale (tentative 1) │
└─────────────────┬───────────────────┘
                  │
                  ▼
         ┌────────────────┐
         │   Validation   │
         └────────┬───────┘
                  │
       ┌──────────┴──────────┐
       │                     │
       ▼                     ▼
   ✅ Succès            ❌ Échec
       │                     │
       │                     ▼
       │          ┌──────────────────────┐
       │          │ Retry 1 (tentative 2)│
       │          │ + contexte d'erreur  │
       │          └──────────┬───────────┘
       │                     │
       │                     ▼
       │            ┌────────────────┐
       │            │   Validation   │
       │            └────────┬───────┘
       │                     │
       │          ┌──────────┴──────────┐
       │          │                     │
       │          ▼                     ▼
       │      ✅ Succès            ❌ Échec
       │          │                     │
       │          │                     ▼
       │          │          ┌──────────────────────┐
       │          │          │ Retry 2 (tentative 3)│
       │          │          │ + contexte d'erreur  │
       │          │          └──────────┬───────────┘
       │          │                     │
       │          │                     ▼
       │          │            ┌────────────────┐
       │          │            │   Validation   │
       │          │            └────────┬───────┘
       │          │                     │
       │          │          ┌──────────┴──────────┐
       │          │          │                     │
       │          │          ▼                     ▼
       │          │      ✅ Succès            ❌ Échec final
       │          │          │                     │
       └──────────┴──────────┴─────────────────────┘
                              │
                              ▼
                    ┌─────────────────────┐
                    │ Sauvegarde contenu  │
                    │ + statut éditorial  │
                    └─────────────────────┘
```

## Logique de retry

### 1. Détection des erreurs

Après chaque génération, le système valide tous les champs selon les règles du template :

- `required`: champ obligatoire
- `max_length`: longueur maximale
- `min_length`: longueur minimale
- `sentence_count`: nombre de phrases exact
- `forbidden_words`: mots interdits (vocabulaire promotionnel)
- `forbidden_patterns`: patterns regex interdits
- `forbidden_temporal_terms`: termes temporels interdits

### 2. Construction du contexte de retry

Si la validation échoue, le système construit un contexte détaillé pour l'IA :

```
⚠️ ATTENTION - TENTATIVE 2/3

Les champs suivants ont échoué la validation et DOIVENT être corrigés :

Champ "POI_texte_accroche":
  - La phrase ne doit pas dépasser 120 caractères (actuel: 145)
  - Le vocabulaire promotionnel est interdit
  - Les termes temporels sont interdits

Champ "POI_titre_1":
  - Maximum 60 caractères (actuel: 75)

CHAMPS À REGÉNÉRER UNIQUEMENT : POI_texte_accroche, POI_titre_1

Contenu précédent de ces champs (INCORRECT) :
POI_texte_accroche: "Siam Park est aujourd'hui un parc aquatique incontournable et magnifique situé à Tenerife, offrant une expérience unique pour toute la famille."
POI_titre_1: "Siam Park - Le plus grand parc aquatique d'Europe à Tenerife"

INSTRUCTIONS STRICTES :
1. NE régénère QUE les champs en erreur ci-dessus
2. Respecte IMPÉRATIVEMENT les règles de validation (longueur, mots interdits, etc.)
3. Les autres champs sont déjà corrects, ne les modifie PAS
```

### 3. Backoff progressif

Entre chaque tentative, le système attend un délai croissant :

- Tentative 1 → 2 : 1 seconde
- Tentative 2 → 3 : 2 secondes

Cela évite de surcharger l'API OpenAI et laisse plus de "temps de réflexion" au modèle.

### 4. Fusion des contenus

Le système conserve les champs déjà valides d'une tentative à l'autre :

```typescript
// Tentative 1
generatedContent = {
  POI_titre_1: "Siam Park Tenerife",           // ✅ Valide
  POI_texte_accroche: "Trop long...",          // ❌ Erreur
  POI_image_1: "https://..."                   // ✅ Valide
}

// Tentative 2 (fusion)
generatedContent = {
  POI_titre_1: "Siam Park Tenerife",           // ✅ Conservé
  POI_texte_accroche: "Version corrigée",      // 🔄 Regénéré
  POI_image_1: "https://..."                   // ✅ Conservé
}
```

## Statuts éditoriaux

Selon le résultat de la génération, différents statuts sont attribués :

| Statut | Condition | Description |
|--------|-----------|-------------|
| `generee_ia` | Validation réussie (1-3 tentatives) | Contenu généré avec succès |
| `non_conforme` | Validation échouée après 3 tentatives | Contenu généré mais non conforme |
| `non_conforme` | Erreur IA ou technique | Erreur lors de la génération |

## Commentaires internes

Le système ajoute automatiquement un commentaire interne pour traçabilité :

### Succès avec retry

```
Généré avec succès après 2 tentative(s)
```

### Échec de validation

```
Validation échouée après 3 tentative(s): POI_texte_accroche (2 erreur(s)), POI_titre_1 (1 erreur(s))
```

### Erreur technique

```
Erreur IA: Article WordPress source non trouvé
```

## Exemple de logs

```
🚀 [WORKER] Génération contenu page 6985a4e26cbb4d29bda8b65e
🔄 Tentative 1/3
📝 Prompt construit, appel OpenAI...
✅ Contenu généré, validation...
⚠️ Validation échouée (tentative 1): 2 champs en erreur
   - POI_texte_accroche: Longueur max dépassée, mots interdits
   - POI_titre_1: Longueur max dépassée

🔄 Tentative 2/3
📝 Prompt construit, appel OpenAI...
✅ Contenu généré, validation...
⚠️ Validation échouée (tentative 2): 1 champ en erreur
   - POI_texte_accroche: Mots interdits

🔄 Tentative 3/3
📝 Prompt construit, appel OpenAI...
✅ Contenu généré, validation...
✅ Validation réussie après 3 tentative(s)
✅ [WORKER] Contenu sauvegardé pour page 6985a4e26cbb4d29bda8b65e (statut: generee_ia)
```

## Interface de validation

### FieldValidatorService

Service dédié à la validation des champs :

```typescript
export class FieldValidatorService {
  /**
   * Valide un contenu généré selon les règles du template
   */
  validateContent(
    content: Record<string, any>,
    fields: TemplateField[]
  ): ValidationResult;

  /**
   * Formate les erreurs pour un prompt de retry
   */
  formatErrorsForRetry(errors: ValidationError[]): string;

  /**
   * Extrait les noms des champs en erreur
   */
  getFailedFields(errors: ValidationError[]): string[];
}
```

### Exemple d'utilisation

```typescript
const validator = new FieldValidatorService();

// Valider le contenu
const validation = validator.validateContent(generatedContent, template.fields);

if (!validation.isValid) {
  // Construire contexte de retry
  const errorContext = validator.formatErrorsForRetry(validation.errors);
  const failedFields = validator.getFailedFields(validation.errors);
  
  // Ajouter au prompt pour retry
  prompt += `\n\n⚠️ ATTENTION\n${errorContext}`;
}
```

## Configuration

### Nombre de retries

Le nombre maximum de retries est défini dans `PageRedactionService` :

```typescript
private readonly MAX_RETRIES = 3;
```

Pour modifier cette limite, changer la constante et redéployer l'API.

### Délai entre retries

Le délai est calculé dynamiquement :

```typescript
await this.sleep(1000 * retryCount); // 1s, 2s, 3s...
```

## Bonnes pratiques

### 1. Définir des règles de validation strictes

Plus les règles sont précises, meilleures sont les corrections :

```json
{
  "validation": {
    "required": true,
    "max_length": 120,
    "forbidden_words": ["incontournable", "magnifique", "exceptionnel"],
    "messages": {
      "max_length": "Maximum 120 caractères (titre + contexte)",
      "forbidden_words": "Éviter le vocabulaire promotionnel"
    }
  }
}
```

### 2. Limiter le nombre de règles par champ

Trop de règles complexes rendent la correction difficile pour l'IA :

- ✅ 3-5 règles simples et claires
- ❌ 10+ règles complexes et contradictoires

### 3. Fournir des messages d'erreur explicites

Les messages apparaissent dans le prompt de retry :

```json
{
  "messages": {
    "sentence_count": "Utiliser exactement 2 phrases courtes"
  }
}
```

### 4. Tester avec des templates simples

Commencer avec 1-2 champs validés, puis augmenter progressivement.

## Limitations

1. **Max 3 retries** : au-delà, le contenu est sauvegardé en `non_conforme`
2. **Coût API** : chaque retry = 1 appel OpenAI supplémentaire
3. **Temps de génération** : peut prendre 30-60 secondes avec retries
4. **Fusion de contenu** : les champs valides sont conservés (pas de régénération globale)

## Surveillance

### Logs à surveiller

- `⚠️ Validation échouée` : champs en erreur fréquents
- `❌ Échec après 3 tentatives` : règles trop strictes ou IA inefficace
- `✅ Validation réussie après X tentative(s)` : efficacité du système

### Métriques recommandées

- Taux de succès au 1er essai
- Taux de succès après retry
- Nombre moyen de retries par page
- Champs les plus souvent en erreur

## Évolutions futures

- [ ] Retry sélectif par champ (appels OpenAI plus petits)
- [ ] Cache de validations pour éviter retests
- [ ] Machine learning pour prédire les erreurs
- [ ] Interface admin pour visualiser les retries
