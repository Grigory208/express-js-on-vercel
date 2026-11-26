const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const app = express();
app.use(express.json());

// Берём данные из переменных окружения Layero
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://vrcpbbwzyejdupebhvkl.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZyY3BiYnd6eWVqZHVwZWJodmtsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkxMjU4NzYsImV4cCI6MjEwNDcwMTg3Nn0.oE1Fu9IlU69u_D28NP6tcYjgb2pSNLVn4FmOiT5NNqA';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const UA = 'VerteX-Launcher skin-server/1.0';

// Генератор правильного Minecraft UUID (v3)
function getOfflineUUID(username) {
  const hash = crypto.createHash('md5').update('OfflinePlayer:' + username).digest();
  hash[6] = (hash[6] & 0x0f) | 0x30;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// ===== ИНЖЕКТОР СКИНОВ: GET /skin/<ник> =====
// Цепочка провайдеров (первый успешный побеждает):
//   1. Своя база: profiles.username → skins (active) — скины игроков VerteX.
//   2. Mojang: api.mojang.com → sessionserver (лицензионные ники) + модель из метаданных.
//   3. Внешние хостинги/лаунчеры: ely.by → mc-heads.net → minotar.net (бесплатно, без ключей).

async function fetchPng(url, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': UA, Accept: 'image/png,image/*' },
      redirect: 'follow',
    });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 70 || buf.length > 5 * 1024 * 1024) return null;
    if (!buf.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
    return buf;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// 1. Своя база: ник игрока → его активный скин
async function fromVertexDb(name) {
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('username', name)
      .maybeSingle();
    if (!profile) return null;
    const { data: skin } = await supabase
      .from('skins')
      .select('skin_url, skin_type')
      .eq('user_id', profile.id)
      .eq('active', true)
      .maybeSingle();
    if (!skin || !skin.skin_url) return null;
    const png = await fetchPng(skin.skin_url);
    if (!png) return null;
    return { png, model: skin.skin_type === 'slim' ? 'slim' : 'classic' };
  } catch {
    return null;
  }
}

// 2. Mojang: ник → uuid → подписанные текстуры профиля
async function fromMojang(name) {
  try {
    const r1 = await fetch(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(name)}`, {
      headers: { 'User-Agent': UA },
    });
    if (!r1.ok) return null;
    const profile = await r1.json();
    if (!profile || !profile.id) return null;

    const r2 = await fetch(`https://sessionserver.mojang.com/session/minecraft/profile/${profile.id}?unsigned=false`, {
      headers: { 'User-Agent': UA },
    });
    if (!r2.ok) return null;
    const data = await r2.json();
    const prop = (data.properties || []).find((p) => p.name === 'textures');
    if (!prop) return null;
    const textures = JSON.parse(Buffer.from(prop.value, 'base64').toString('utf8'));
    const skin = textures.textures && textures.textures.SKIN;
    if (!skin || !skin.url) return null;
    const png = await fetchPng(skin.url);
    if (!png) return null;
    const model = skin.metadata && skin.metadata.model === 'slim' ? 'slim' : 'classic';
    return { png, model };
  } catch {
    return null;
  }
}

// 3. Внешние хостинги и лаунчеры
const FALLBACKS = [
  { name: 'ely.by', url: (n) => `https://skinsystem.ely.by/skins/${encodeURIComponent(n)}.png` },
  { name: 'mc-heads.net', url: (n) => `https://mc-heads.net/skin/${encodeURIComponent(n)}` },
  { name: 'minotar.net', url: (n) => `https://minotar.net/skin/${encodeURIComponent(n)}` },
];

function sendSkin(res, png, model, source) {
  res.set('Content-Type', 'image/png');
  res.set('X-Vertex-Skin-Model', model === 'slim' ? 'slim' : 'classic');
  res.set('X-Vertex-Skin-Source', source);
  res.set('Cache-Control', 'public, max-age=300, s-maxage=600');
  res.status(200).send(png);
}

app.get('/skin/:name', async (req, res) => {
  const name = String(req.params.name || '').trim();
  if (!/^[A-Za-z0-9_]{1,16}$/.test(name)) {
    return res.status(400).json({ error: 'bad nickname' });
  }
  try {
    const db = await fromVertexDb(name);
    if (db) return sendSkin(res, db.png, db.model, 'vertex-db');
    const mj = await fromMojang(name);
    if (mj) return sendSkin(res, mj.png, mj.model, 'mojang');
    for (const p of FALLBACKS) {
      const png = await fetchPng(p.url(name));
      if (png) return sendSkin(res, png, 'classic', p.name);
    }
    return res.status(404).json({ error: 'skin not found' });
  } catch {
    return res.status(502).json({ error: 'upstream failed' });
  }
});

app.get('/health', (req, res) => {
  res.json({ ok: true, db: Boolean(SUPABASE_URL && SUPABASE_KEY) });
});

// ===== AUTHLIB (Yggdrasil-совместимые эндпоинты) =====

// 1. Авторизация (связываем ник и UUID)
app.post('/authserver/authenticate', async (req, res) => {
  const { username } = req.body;
  const mcUuid = getOfflineUUID(username);

  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, minecraft_uuid')
      .eq('username', username)
      .maybeSingle();

    if (profile) {
      if (!profile.minecraft_uuid) {
        await supabase.from('profiles').update({ minecraft_uuid: mcUuid }).eq('id', profile.id);
      }
    }
  } catch (e) {
    console.error('Ошибка привязки UUID:', e);
  }

  res.json({
    accessToken: 'token-' + mcUuid,
    clientToken: 'client-token',
    availableProfiles: [{ name: username, id: mcUuid.replace(/-/g, '') }],
    selectedProfile: { name: username, id: mcUuid.replace(/-/g, '') }
  });
});

// 2. Выдача скина
app.get('/sessionserver/session/minecraft/profile/:uuid', async (req, res) => {
  const { uuid } = req.params;

  const formattedUuid = uuid.includes('-') ? uuid :
    `${uuid.slice(0, 8)}-${uuid.slice(8, 12)}-${uuid.slice(12, 16)}-${uuid.slice(16, 20)}-${uuid.slice(20)}`;

  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, username')
      .eq('minecraft_uuid', formattedUuid)
      .maybeSingle();

    // Скина нет — отдаём профиль БЕЗ свойства textures (ванила покажет Стива),
    // а не фейковую ссылку http://textures.minecraft.net/texture/...
    let skin = null;
    if (profile) {
      const { data } = await supabase
        .from('skins')
        .select('skin_url, skin_type')
        .eq('user_id', profile.id)
        .eq('active', true)
        .maybeSingle();
      skin = data;
    }

    const response = {
      id: uuid,
      name: (profile && profile.username) || 'Player',
      properties: []
    };

    if (skin && skin.skin_url && /^https:\/\//.test(skin.skin_url)) {
      const textures = {
        timestamp: Date.now(),
        profileId: uuid,
        profileName: (profile && profile.username) || 'Player',
        textures: {
          SKIN: {
            url: skin.skin_url,
            ...(skin.skin_type === 'slim' ? { metadata: { model: 'slim' } } : {})
          }
        }
      };
      response.properties.push({
        name: 'textures',
        value: Buffer.from(JSON.stringify(textures)).toString('base64')
      });
    }

    res.json(response);
  } catch (err) {
    console.error('Ошибка базы данных:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Метаданные сервера (authlib-injector требует именно JSON)
app.get('/', (req, res) => {
  res.json({
    meta: {
      serverName: 'Vertex Skin Server',
      implementationName: 'Vertex Launcher',
      implementationVersion: '1.0.0'
    },
    skinDomains: [
      'layero.app',     // Разрешаем Layero
      'supabase.co'     // КРИТИЧЕСКИ ВАЖНО: разрешаем грузить картинки из твоего Supabase!
    ]
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Сервер скинов запущен на порту ${PORT}`);
});
