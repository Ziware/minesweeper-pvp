#!/usr/bin/env node
/**
 * Кодоген: читает [`balance.json`](packages/shared/src/balance.json:1) и
 * пишет [`balance.generated.ts`](packages/shared/src/balance.generated.ts:1)
 * с тем же содержимым в виде TS-литерала.
 *
 * Зачем: ts-node-dev в режиме --transpile-only не подключает loader для
 * .json-модулей, и runtime-импорт JSON ломается. TS-литерал работает
 * единообразно во всех окружениях (Vite, tsc, ts-node-dev, Docker).
 *
 * Запуск: `node packages/shared/scripts/gen-balance.js`
 * (вызывается автоматически из yarn-скриптов: prebuild / predev).
 */
const fs = require('fs');
const path = require('path');

const SRC_DIR  = path.resolve(__dirname, '..', 'src');
const JSON_IN  = path.join(SRC_DIR, 'balance.config.json');
const TS_OUT   = path.join(SRC_DIR, 'balance.generated.ts');

const raw = fs.readFileSync(JSON_IN, 'utf-8');
const data = JSON.parse(raw);

// Удаляем мета-поле $schema, оно не нужно в рантайме.
delete data.$schema;

const body = JSON.stringify(data, null, 2);

const out = `/* eslint-disable */
// AUTO-GENERATED FROM balance.json. DO NOT EDIT BY HAND.
// Запустите \`yarn balance:gen\` (или любой yarn dev/build) после правок balance.json.

export const BALANCE_DATA = ${body} as const;
`;

fs.writeFileSync(TS_OUT, out, 'utf-8');
console.log(`[gen-balance] wrote ${path.relative(process.cwd(), TS_OUT)}`);
