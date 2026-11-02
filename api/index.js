const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const app = express();
app.use(express.json());

// Берем данные из переменных окружения Layero
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://vrcpbbwzyejdupebhvkl.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZyY3BiYnd6eWVqZHVwZWJodmtsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkxMjU4NzYsImV4cCI6MjEwNDcwMTg3Nn0.oE1Fu9IlU69u_D28NP6tcYjgb2pSNLVn4FmOiT5NNqA';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Функция для генерации UUID по нику (нужно для пиратки)
function getOfflineUUID(username) {
  const hash = crypto.createHash('md5').update('OfflinePlayer:' + username).digest();
  hash[6] = (hash[6] & 0x0f) | 0x30;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// 1. Авторизация (Yggdrasil)
app.post('/authserver/authenticate', (req, res) => {
  const { username } = req.body;
  const user = username || 'Player';
  const uuid = getOfflineUUID(user);
  
  res.json({
    accessToken: 'token-' + uuid,
    clientToken: 'client-token',
    availableProfiles: [{ name: user, id: uuid.replace(/-/g, '') }],
    selectedProfile: { name: user, id: uuid.replace(/-/g, '') }
  });
});

// 2. Выдача скина (Yggdrasil)
app.get('/sessionserver/session/minecraft/profile/:uuid', async (req, res) => {
  const { uuid } = req.params;
  
  try {
    // Ищем активный скин в твоей базе Supabase
    const { data, error } = await supabase
      .from('skins')
      .select('skin_url')
      .eq('active', true)
      .limit(1)
      .maybeSingle(); // Используем maybeSingle, чтобы не было ошибки, если скина нет

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
  } catch (err) {
    console.error('Ошибка базы данных:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// 3. Проверка работоспособности (чтобы браузер показывал, что сервер жив)
app.get('/', (req, res) => {
  res.send('✅ Сервер скинов работает!');
});

// ⬇️ САМОЕ ВАЖНОЕ ДЛЯ LAYERO ⬇️
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Сервер скинов запущен на порту ${PORT}`);
});