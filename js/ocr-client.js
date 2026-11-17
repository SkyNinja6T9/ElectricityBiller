/**
 * OCR Client for Electricity Bill Scanner
 * Handles image downscaling (for fast upload & staying under OCR.space 1MB free tier limit),
 * camera capture, and communication with /api/ocr
 */
const OCRClient = (function() {

  /**
   * Resize and compress image file to data URL (JPEG <= 1MB)
   * @param {File} file
   * @param {number} maxDimension - e.g. 1600px
   * @param {number} quality - e.g. 0.85
   * @returns {Promise<string>} Base64 Data URL
   */
  function compressImage(file, maxDimension = 1600, quality = 0.85) {
    return new Promise((resolve, reject) => {
      // If PDF, read directly as data URL
      if (file.type === 'application/pdf') {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          let { width, height } = img;
          if (width > maxDimension || height > maxDimension) {
            if (width > height) {
              height = Math.round((height * maxDimension) / width);
              width = maxDimension;
            } else {
              width = Math.round((width * maxDimension) / height);
              height = maxDimension;
            }
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);

          // Export compressed JPEG
          const dataUrl = canvas.toDataURL('image/jpeg', quality);
          resolve(dataUrl);
        };
        img.onerror = () => reject(new Error('Failed to load image for compression'));
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  /**
   * Scan bill image through /api/ocr
   * @param {string} imageBase64 
   * @param {string} passcode 
   * @param {Function} onProgress 
   */
  async function scanBill(imageBase64, passcode, onProgress) {
    if (typeof onProgress === 'function') {
      onProgress('Uploading bill to OCR server...');
    }

    const response = await fetch('/api/ocr', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-app-passcode': passcode || ''
      },
      body: JSON.stringify({
        imageBase64: imageBase64,
        passcode: passcode,
        ocrEngine: '2'
      })
    });

    if (typeof onProgress === 'function') {
      onProgress('Analyzing OCR recognition results...');
    }

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || data.error || 'Failed to scan bill');
    }

    return data;
  }

  return {
    compressImage,
    scanBill
  };
})();
