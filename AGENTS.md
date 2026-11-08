# AGENTS.md

Ce dépôt est un serveur MCP pour pare-feu OPNsense (`osmcp`, TypeScript dans `src/`, Rust dans `rust/`).

- **Utiliser le serveur** (outils `opn_*`) : lire [`skill/opnmcp-rust/SKILL.md`](skill/opnmcp-rust/SKILL.md). Il décrit les 209 outils, ce qui est possible et impossible, et les recettes (cycle préparer, appliquer, confirmer ; erreurs et remèdes).
- **Modifier le code** : `npm test` et `npm run typecheck`. Ajouter ou renommer un outil impose de mettre à jour le tableau du skill, sinon `test/skill.test.ts` échoue. Le Rust doit rester identique au TypeScript (`node bench/parite.mjs`).
- Lecture seule par défaut : ne jamais activer `OPNSENSE_ALLOW_WRITES` ni débloquer un point d'API sans demande explicite de l'utilisateur.
