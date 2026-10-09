/* Colours Flex Printing: blank-page/login navigation recovery patch.
   Load this AFTER the existing script.js. Do not replace script.js with this file. */
(function () {
  'use strict';
  function initialiseVisibilityAndLogin() {
    const loginScreen = document.getElementById('loginScreen');
    const mainApp = document.getElementById('mainApp');
    const loginButton = document.getElementById('loginNavButton');
    const logoutButton = document.getElementById('logoutButton');
    const loginMessage = document.getElementById('loginMessage');

    // The billing interface must not stay hidden just because no session exists.
    if (mainApp) mainApp.hidden = false;
    if (loginScreen) {
      loginScreen.hidden = true;
      loginScreen.style.display = 'none';
    }
    if (!loginButton || !loginScreen) return;

    // Rebind the Login tab so it opens the existing login overlay on demand.
    loginButton.onclick = function () {
      if (loginScreen) {
        loginScreen.hidden = false;
        loginScreen.style.display = 'grid';
      }
      if (loginMessage) {
        loginMessage.textContent = window.COLOURS_SUPABASE_URL && window.COLOURS_SUPABASE_ANON_KEY
          ? 'Enter your authorized portal email and password.'
          : 'Supabase configuration is missing. Check supabase-config.js.';
      }
      const email = document.getElementById('loginEmail');
      if (email) email.focus();
    };

    // Clicking outside the card closes the login overlay.
    loginScreen.onclick = function (event) {
      if (event.target === loginScreen) {
        loginScreen.hidden = true;
        loginScreen.style.display = 'none';
      }
    };

    // Keep the billing interface visible when signing out.
    if (logoutButton) {
      logoutButton.addEventListener('click', function () {
        if (mainApp) mainApp.hidden = false;
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialiseVisibilityAndLogin);
  } else {
    initialiseVisibilityAndLogin();
  }
})();
