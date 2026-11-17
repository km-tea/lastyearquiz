import { publicConfig } from '../lib/config.js';
import { json } from '../lib/http.js';

export default async () => json(publicConfig());

export const config = { path: '/api/config' };
