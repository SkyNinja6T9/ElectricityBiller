const { parseElectricityBill } = require('./lib/billParser');

// Vercel Serverless Function Configuration
module.exports.config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb'
    }
  }
};

const DEFAULT_PASSCODE = '1234';

module.exports = async function handler(req, res) {
  // 1. CORS headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, x-app-passcode'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed. Use POST.' });
  }

  try {
    const { imageBase64, fileUrl, passcode: bodyPasscode, ocrEngine = '2' } = req.body || {};
    const headerPasscode = req.headers['x-app-passcode'];
    const clientPasscode = headerPasscode || bodyPasscode;
    const requiredPasscode = process.env.APP_PASSCODE || DEFAULT_PASSCODE;

    // 2. Closed user verification
    if (requiredPasscode && clientPasscode !== requiredPasscode) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid access passcode. This application is restricted to authorized users.'
      });
    }

    if (!imageBase64 && !fileUrl) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Please provide imageBase64 or fileUrl.'
      });
    }

    const apiKey = process.env.OCR_SPACE_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        error: 'Configuration Error',
        message: 'OCR_SPACE_API_KEY is not configured in environment variables. Please configure it in your .env or Vercel dashboard.'
      });
    }

    // 3. Prepare OCR Space API payload
    const formData = new FormData();
    formData.append('apikey', apiKey);
    formData.append('language', 'eng');
    formData.append('isOverlayRequired', 'false');
    formData.append('detectOrientation', 'true');
    formData.append('scale', 'true');
    formData.append('OCREngine', String(ocrEngine));

    if (imageBase64) {
      formData.append('base64Image', imageBase64);
    } else if (fileUrl) {
      formData.append('url', fileUrl);
    }

    // 4. Call OCR Space API
    const startTime = Date.now();
    const ocrResponse = await fetch('https://api.ocr.space/parse/image', {
      method: 'POST',
      body: formData
    });

    if (!ocrResponse.ok) {
      throw new Error(`OCR Space API responded with HTTP status ${ocrResponse.status}`);
    }

    const ocrData = await ocrResponse.json();

    // Check for OCR Space API errors
    if (ocrData.IsErroredOnProcessing) {
      const errMsg = Array.isArray(ocrData.ErrorMessage) 
        ? ocrData.ErrorMessage.join(', ') 
        : (ocrData.ErrorMessage || 'OCR processing failed');
      return res.status(422).json({
        error: 'OCR Error',
        message: errMsg,
        details: ocrData
      });
    }

    const parsedResults = ocrData.ParsedResults || [];
    let fullParsedText = parsedResults.map(r => r.ParsedText || '').join('\n').trim();

    // If Engine 2 returned empty text, try fallback to Engine 1
    if (!fullParsedText && ocrEngine === '2') {
      const fallbackFormData = new FormData();
      fallbackFormData.append('apikey', apiKey);
      fallbackFormData.append('language', 'eng');
      fallbackFormData.append('isOverlayRequired', 'false');
      fallbackFormData.append('detectOrientation', 'true');
      fallbackFormData.append('scale', 'true');
      fallbackFormData.append('OCREngine', '1');
      if (imageBase64) fallbackFormData.append('base64Image', imageBase64);
      else if (fileUrl) fallbackFormData.append('url', fileUrl);

      const fallbackRes = await fetch('https://api.ocr.space/parse/image', {
        method: 'POST',
        body: fallbackFormData
      });
      if (fallbackRes.ok) {
        const fallbackData = await fallbackRes.json();
        const fallbackResults = fallbackData.ParsedResults || [];
        fullParsedText = fallbackResults.map(r => r.ParsedText || '').join('\n').trim();
      }
    }

    const parseDurationMs = Date.now() - startTime;

    // 5. Intelligent Electricity Bill Extraction
    const extraction = parseElectricityBill(fullParsedText);

    return res.status(200).json({
      success: true,
      rawText: fullParsedText,
      extracted: extraction.data,
      metadata: {
        ocrEngineUsed: ocrEngine,
        processingTimeMs: parseDurationMs,
        ocrExitCode: ocrData.OCRExitCode
      }
    });

  } catch (error) {
    console.error('OCR Processing Error:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: error.message || 'An error occurred while processing the bill image.'
    });
  }
};
