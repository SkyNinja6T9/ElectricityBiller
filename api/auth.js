const DEFAULT_PASSCODE = '1234';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-app-passcode');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { passcode } = req.body || {};
    const requiredPasscode = process.env.APP_PASSCODE || DEFAULT_PASSCODE;

    if (!passcode) {
      return res.status(400).json({ error: 'Passcode is required' });
    }

    if (passcode.trim() === requiredPasscode.trim()) {
      return res.status(200).json({
        success: true,
        message: 'Access granted'
      });
    } else {
      return res.status(401).json({
        success: false,
        error: 'Invalid passcode'
      });
    }
  } catch (err) {
    return res.status(500).json({ error: 'Server error', message: err.message });
  }
};
