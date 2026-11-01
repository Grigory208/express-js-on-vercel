const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const app = express();
app.use(express.json());

// ⬇️ ВСТАВЬ СЮДА СВОИ ДАННЫЕ ОТ SUPABASE ⬇️
const SUPABASE_URL = 'https://твой-проект.supabase.co';
const SUPABASE_KEY = 'твой-публичный-anon-ключ';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function getOfflineUUID(username) {
  const hash = crypto.createHash('md5').update('OfflinePlayer:' + username).digest();
  hash[6] = (hash[6] & 0x0f) | 0x30;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// 1. Авторизация
app.post('/authserver/authenticate', (req, res) => {
  const { username } = req.body;
  const uuid = getOfflineUUID(username);
  res.json({
    accessToken: 'token-' + uuid,
    clientToken: 'client-token',
    availableProfiles: [{ name: username, id: uuid.replace(/-/g, '') }],
    selectedProfile: { name: username, id: uuid.replace(/-/g, '') }
  });
});

// 2. Выдача скина
app.get('/sessionserver/session/minecraft/profile/:uuid', async (req, res) => {
  const { uuid } = req.params;
  
  const { data } = await supabase
    .from('skins')
    .select('skin_url')
    .eq('active', true)
    .limit(1)
    .single();

  let skinUrl = data?.skin_url || 'http://textures.minecraft.net/texture/...'; 

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
});

// Экспортируем для Vercel
module.exports = app;
