# AGENTS.md

Ce dépôt est un serveur MCP pour pare-feu OPNsense (`osmcp`, TypeScript dans `src/`, Rust dans `rust/`).

- **Utiliser le serveur** (outils `opn_*`) : lire [`skill/opnmcp-rust/SKILL.md`](skill/opnmcp-rust/SKILL.md). Il décrit les 210 outils, ce qui est possible et impossible, le mode test (`MCP_TEST_MODE=1`, à utiliser pour exercer n'importe quelle commande sans risque), `opn_stats` et les recettes (cycle préparer, appliquer, confirmer ; erreurs et remèdes).
- **Modifier le code** : `npm test` et `npm run typecheck`. Ajouter ou renommer un outil impose de régénérer le tableau du skill (`npm run build && node scripts/gen-skill-table.mjs`), sinon `test/skill.test.ts` échoue. Tout I/O réseau passe par `src/opnsense/transport.ts` : `test/testmode-static.test.ts` échoue sinon. Le Rust doit rester identique au TypeScript (`node bench/parite.mjs`).
- Lecture seule par défaut : ne jamais activer `OPNSENSE_ALLOW_WRITES` ni débloquer un point d'API sans demande explicite de l'utilisateur.
