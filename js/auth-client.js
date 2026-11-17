/**
 * Auth Client for Closed-User Access Gate
 */
const AuthClient = (function() {
  const STORAGE_KEY = 'electricity_biller_auth_passcode';

  function getPasscode() {
    return localStorage.getItem(STORAGE_KEY) || '';
  }

  function isAuthenticated() {
    return !!getPasscode();
  }

  async function verifyPasscode(passcode) {
    if (!passcode) {
      return { success: false, message: 'Please enter a passcode' };
    }

    try {
      const response = await fetch('/api/auth', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ passcode: passcode.trim() })
      });

      const data = await response.json();
      if (response.ok && data.success) {
        localStorage.setItem(STORAGE_KEY, passcode.trim());
        return { success: true };
      } else {
        return {
          success: false,
          message: data.error || data.message || 'Invalid passcode'
        };
      }
    } catch (err) {
      // Offline fallback: if API is unreachable (e.g. static preview), check against default
      if (passcode.trim() === '1234') {
        localStorage.setItem(STORAGE_KEY, passcode.trim());
        return { success: true };
      }
      return { success: false, message: 'Authentication error: ' + err.message };
    }
  }

  function logout() {
    localStorage.removeItem(STORAGE_KEY);
    window.location.reload();
  }

  return {
    getPasscode,
    isAuthenticated,
    verifyPasscode,
    logout
  };
})();
