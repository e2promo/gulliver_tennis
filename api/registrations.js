// /api/registrations.js
// Vercel Serverless Function — хранение регистраций в Vercel KV (Redis)

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Token',
};

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'ghDTfdSTkzESSpBPcJy9';

// Проверяем наличие переменных окружения KV
function checkKvEnv() {
  const missing = [];
  if (!process.env.KV_REST_API_URL)   missing.push('KV_REST_API_URL');
  if (!process.env.KV_REST_API_TOKEN) missing.push('KV_REST_API_TOKEN');
  return missing;
}

module.exports = async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    return res.end();
  }

  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));

  // ── Диагностика: проверяем переменные KV ──
  const missingEnv = checkKvEnv();
  if (missingEnv.length > 0) {
    return res.status(503).json({
      success: false,
      message: 'База данных не подключена. Выполните шаги 3–4 из SETUP.md',
      missing_env: missingEnv,
      fix: 'Зайдите в Vercel Dashboard → Storage → создайте KV → подключите к проекту → передеплойте',
    });
  }

  // Подключаем KV только если переменные есть
  let kv;
  try {
    ({ kv } = require('@vercel/kv'));
  } catch (e) {
    return res.status(500).json({
      success: false,
      message: 'Пакет @vercel/kv не установлен',
      error: e.message,
      fix: 'Убедитесь что package.json содержит "@vercel/kv" в dependencies',
    });
  }

  try {
    // ── POST — сохранить новую регистрацию ──
    if (req.method === 'POST') {
      let data = req.body;
      if (typeof data === 'string') {
        try { data = JSON.parse(data); } catch (e) {}
      }

      if (!data || !data.last || !data.first) {
        return res.status(400).json({ success: false, message: 'Недостаточно данных: нужны поля last и first' });
      }

      const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const count = await kv.incr('reg:counter');

      const registration = {
        id,
        num: count,
        ...data,
        ts: new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }),
      };

      await kv.set(`reg:entry:${id}`, registration);
      await kv.zadd('reg:index', { score: Date.now(), member: id });

      return res.status(200).json({
        success: true,
        message: 'Регистрация сохранена',
        count,
        id,
      });
    }

    // ── GET — получить все регистрации ──
    if (req.method === 'GET') {
      const ids = await kv.zrange('reg:index', 0, -1);

      if (!ids || ids.length === 0) {
        return res.status(200).json({ success: true, data: [], count: 0 });
      }

      const entries = await Promise.all(
        ids.map((id) => kv.get(`reg:entry:${id}`))
      );

      const data = entries.filter(Boolean);

      return res.status(200).json({
        success: true,
        data,
        count: data.length,
      });
    }

    // ── DELETE — удалить одну или все регистрации ──
    if (req.method === 'DELETE') {
      const token = req.headers['x-admin-token'];
      if (token !== ADMIN_TOKEN) {
        return res.status(401).json({ success: false, message: 'Не авторизован: неверный X-Admin-Token' });
      }

      const { id } = req.query;

      if (id === 'all') {
        const ids = await kv.zrange('reg:index', 0, -1);
        if (ids && ids.length > 0) {
          await Promise.all(ids.map((entryId) => kv.del(`reg:entry:${entryId}`)));
        }
        await kv.del('reg:index');
        await kv.del('reg:counter');
        return res.status(200).json({ success: true, message: 'Все записи удалены' });
      }

      if (id) {
        await kv.del(`reg:entry:${id}`);
        await kv.zrem('reg:index', id);
        return res.status(200).json({ success: true, message: 'Запись удалена', id });
      }

      return res.status(400).json({ success: false, message: 'Не указан id для удаления' });
    }

    return res.status(405).json({ success: false, message: 'Метод не поддерживается' });

  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Ошибка сервера: ' + error.message,
      hint: 'Проверьте Vercel Dashboard → Storage → убедитесь что KV подключена к проекту',
    });
  }
};