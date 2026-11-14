#!/bin/sh
# Preuve B sous isolement réseau OS : les tests du mode test tournent dans un conteneur sans AUCUNE interface réseau
# (docker --network none). Étape 1 (réseau permis) : installe les dépendances dans un volume. Étape 2 : tests sans réseau.
# Sous Linux sans docker : sudo unshare -n sh -c 'ip link set lo up; npx vitest run test/testmode.test.ts test/testmode-static.test.ts'
set -e
export MSYS_NO_PATHCONV=1
SRC="$(cd "$(dirname "$0")/.." && (pwd -W 2>/dev/null || pwd))"
IMG=node:22-slim
docker run --rm -v "$SRC":/src:ro -v osmcp-iso:/w "$IMG" sh -c 'cd /w && rm -rf src test && cp -r /src/src /src/test /src/package.json /src/package-lock.json /src/tsconfig.json . && npm ci --silent'
docker run --rm --network none -v osmcp-iso:/w -w /w "$IMG" sh -c '
  echo "interfaces réseau du conteneur : $(ls /sys/class/net | tr "\n" " ")";
  node -e "require(\"net\").connect(443,\"1.1.1.1\").on(\"error\",e=>console.log(\"sortie internet : impossible (\"+e.code+\")\")).on(\"connect\",()=>{console.log(\"SORTIE POSSIBLE\");process.exit(1)})";
  npx vitest run test/testmode.test.ts test/testmode-static.test.ts'
