import { loadEnv } from '../src/config/env';
import { createDatabase } from '../src/db/database';

const env = loadEnv();
const db = createDatabase(env.databaseUrl);
db.close();
console.log('Banco migrado com sucesso.');
