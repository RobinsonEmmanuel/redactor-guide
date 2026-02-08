# Format des règles de validation

Ce document décrit le format JSON attendu pour les règles de validation des champs de template.

## Structure complète d'un template avec validation

```json
{
  "name": "POI",
  "description": "Template pour les points d'intérêt",
  "fields": [
    {
      "id": "abc123",
      "type": "titre",
      "name": "POI_titre_1",
      "label": "Nom du lieu",
      "description": "Nom officiel du point d'intérêt",
      "order": 0,
      "max_chars": 60,
      "ai_instructions": "Extraire le nom officiel du lieu depuis le titre de l'article WordPress",
      "validation": {
        "required": true,
        "max_length": 60,
        "min_length": 5,
        "forbidden_words": [
          "incontournable",
          "magnifique",
          "exceptionnel",
          "incroyable",
          "à ne pas manquer",
          "idéal",
          "parfait",
          "unique"
        ],
        "messages": {
          "required": "Le nom du lieu est obligatoire",
          "max_length": "Le nom ne doit pas dépasser 60 caractères",
          "min_length": "Le nom doit contenir au moins 5 caractères",
          "forbidden_words": "Le vocabulaire promotionnel est interdit"
        },
        "severity": "error"
      }
    },
    {
      "id": "def456",
      "type": "texte",
      "name": "POI_texte_accroche",
      "label": "Phrase d'accroche",
      "description": "Phrase courte de contextualisation du lieu",
      "order": 1,
      "max_chars": 120,
      "ai_instructions": "Générer une phrase courte présentant le lieu en une phrase factuelle",
      "validation": {
        "required": true,
        "max_length": 120,
        "min_length": 30,
        "sentence_count": 1,
        "forbidden_words": [
          "incontournable",
          "magnifique",
          "exceptionnel",
          "incroyable"
        ],
        "forbidden_patterns": [
          ":"
        ],
        "forbidden_temporal_terms": [
          "aujourd'hui",
          "actuellement",
          "récemment",
          "en ce moment",
          "dernièrement"
        ],
        "messages": {
          "required": "La phrase d'accroche est obligatoire",
          "max_length": "La phrase ne doit pas dépasser 120 caractères",
          "min_length": "La phrase doit contenir au moins 30 caractères",
          "sentence_count": "La phrase doit contenir une seule phrase",
          "forbidden_words": "Le vocabulaire promotionnel est interdit",
          "forbidden_patterns": "Les deux-points (:) sont interdits",
          "forbidden_temporal_terms": "Les références temporelles sont interdites"
        },
        "severity": "error"
      }
    },
    {
      "id": "ghi789",
      "type": "texte",
      "name": "POI_texte_description",
      "label": "Description détaillée",
      "description": "Paragraphe informatif sur le lieu",
      "order": 2,
      "max_chars": 500,
      "ai_instructions": "Résumer les informations principales de l'article en 2-3 phrases",
      "validation": {
        "required": false,
        "max_length": 500,
        "min_length": 100,
        "forbidden_words": [
          "incontournable",
          "magnifique"
        ],
        "messages": {
          "max_length": "La description ne doit pas dépasser 500 caractères",
          "min_length": "La description doit contenir au moins 100 caractères",
          "forbidden_words": "Évitez le vocabulaire promotionnel"
        },
        "severity": "warning"
      }
    },
    {
      "id": "jkl012",
      "type": "meta",
      "name": "POI_meta_duree",
      "label": "Durée de visite",
      "description": "Temps recommandé pour la visite",
      "order": 3,
      "max_chars": 20,
      "ai_instructions": "Extraire la durée de visite mentionnée (format: 2h30)",
      "validation": {
        "required": false,
        "max_length": 20,
        "messages": {
          "max_length": "Maximum 20 caractères (ex: 2h30)"
        },
        "severity": "error"
      }
    },
    {
      "id": "mno345",
      "type": "image",
      "name": "POI_image_1",
      "label": "Image principale",
      "description": "Photo représentative du lieu",
      "order": 4,
      "ai_instructions": "Sélectionner la première image de l'article WordPress",
      "validation": {
        "required": true,
        "messages": {
          "required": "Une image principale est obligatoire"
        },
        "severity": "error"
      }
    }
  ]
}
```

## Propriétés de validation disponibles

| Propriété | Type | Description | Applicable à |
|-----------|------|-------------|--------------|
| `required` | `boolean` | Champ obligatoire | Tous |
| `max_length` | `number` | Longueur max en caractères | titre, texte, meta |
| `min_length` | `number` | Longueur min en caractères | titre, texte, meta |
| `sentence_count` | `number` | Nombre exact de phrases | texte |
| `forbidden_words` | `string[]` | Mots interdits | titre, texte |
| `forbidden_patterns` | `string[]` | Patterns regex interdits | titre, texte |
| `forbidden_temporal_terms` | `string[]` | Termes temporels interdits | titre, texte |
| `messages` | `Record<string, string>` | Messages d'erreur personnalisés | Tous |
| `severity` | `"error" \| "warning"` | Niveau de gravité | Tous |

## Exemples de règles par type de champ

### Titre court (accroche)
```json
{
  "required": true,
  "max_length": 60,
  "min_length": 10,
  "forbidden_words": ["incontournable", "magnifique", "exceptionnel"],
  "forbidden_patterns": [":", "\\?", "!"],
  "messages": {
    "required": "Le titre est obligatoire",
    "max_length": "Maximum 60 caractères",
    "forbidden_words": "Vocabulaire promotionnel interdit"
  },
  "severity": "error"
}
```

### Texte descriptif
```json
{
  "required": true,
  "max_length": 500,
  "min_length": 100,
  "sentence_count": 3,
  "forbidden_words": ["incroyable", "unique", "parfait"],
  "forbidden_temporal_terms": ["aujourd'hui", "actuellement", "récemment"],
  "messages": {
    "required": "La description est obligatoire",
    "max_length": "Maximum 500 caractères",
    "sentence_count": "3 phrases exactement",
    "forbidden_temporal_terms": "Pas de références temporelles"
  },
  "severity": "error"
}
```

### Métadonnée
```json
{
  "required": false,
  "max_length": 20,
  "messages": {
    "max_length": "Maximum 20 caractères"
  },
  "severity": "warning"
}
```

### Image
```json
{
  "required": true,
  "messages": {
    "required": "Une image est obligatoire"
  },
  "severity": "error"
}
```

## Logique de validation

1. **Frontend** : validation en temps réel lors de la saisie
   - Affichage des erreurs sous le champ
   - Blocage de la sauvegarde si `severity: "error"`
   - Avertissement si `severity: "warning"`

2. **Backend** : validation avant sauvegarde du contenu
   - Retour 400 si validation échoue
   - Détails des erreurs dans la réponse

## Mots interdits recommandés (vocabulaire promotionnel)

```json
[
  "incontournable",
  "magnifique",
  "exceptionnel",
  "incroyable",
  "extraordinaire",
  "fantastique",
  "merveilleux",
  "spectaculaire",
  "sublime",
  "paradisiaque",
  "à ne pas manquer",
  "à couper le souffle",
  "idéal",
  "parfait",
  "unique",
  "authentique",
  "typique",
  "pittoresque",
  "incomparable",
  "remarquable"
]
```

## Termes temporels interdits

```json
[
  "aujourd'hui",
  "actuellement",
  "récemment",
  "en ce moment",
  "dernièrement",
  "ces derniers temps",
  "maintenant",
  "de nos jours",
  "à l'heure actuelle"
]
```

## Notes d'implémentation

- Les règles sont **optionnelles** (champ peut ne pas avoir de validation)
- La validation JSON est **flexible** (seules les propriétés définies sont validées)
- Les messages sont **personnalisables** par règle
- La **severity** permet warnings non-bloquants
- Compatible avec `max_chars` existant (max_chars = limite UI, max_length = validation)
