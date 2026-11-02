const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const app = express();
app.use(express.json());

// Берем данные из переменных окружения Layero
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://vrcpbbwzyejdupebhvkl.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZyY3BiYnd6eWVqZHVwZWJodmtsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkxMjU4NzYsImV4cCI6MjEwNDcwMTg3Nn0.oE1Fu9IlU69u_D28NP6tcYjgb2pSNLVn4FmOiT5NNqA';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Генератор правильного Minecraft UUID (v3)
function getOfflineUUID(username) {
  const hash = crypto.createHash('md5').update('OfflinePlayer:' + username).digest();
  hash[6] = (hash[6] & 0x0f) | 0x30;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

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
      .select('id')
      .eq('minecraft_uuid', formattedUuid)
      .maybeSingle();

    let skinUrl = 'http://textures.minecraft.net/texture/...'; 

    if (profile) {
      const { data: skin } = await supabase
        .from('skins')
        .select('skin_url')
        .eq('user_id', profile.id)
        .eq('active', true)
        .maybeSingle();
        
      if (skin) skinUrl = skin.skin_url;
    }

    const textures = {
      timestamp: Date.now(),
      profileId: uuid,
      profileName: 'Player',
      textures: { SKIN: { url: skinUrl } }
    };

    res.json({
      id: uuid,
      name: 'Player',
      properties: [{ name: 'textures', value: Buffer.from(JSON.stringify(textures)).toString('base64') }]
    });
  } catch (err) {
    console.error('Ошибка базы данных:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ⬇️ ИСПРАВЛЕНИЕ ОШИБКИ INVALID JSON ⬇️
// Отдаем метаданные сервера (authlib-injector требует именно JSON)
app.get('/', (req, res) => {
  res.json({
    meta: {
      serverName: "Vertex Skin Server",
      implementationName: "Vertex Launcher",
      implementationVersion: "1.0.0"
    },
    skinDomains: [
      "layero.app",      // Разрешаем Layero
      "supabase.co"      // КРИТИЧЕСКИ ВАЖНО: Разрешаем грузить картинки из твоего Supabase!
    ]
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Сервер скинов запущен на порту ${PORT}`);
});