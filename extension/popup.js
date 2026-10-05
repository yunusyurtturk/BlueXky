const form = document.getElementById('login');
const account = document.getElementById('account');
const status = document.getElementById('status');
const APP_PASSWORD_FORMAT = /^[a-z0-9]{4}(-[a-z0-9]{4}){3}$/i;

function setStatus(text, isError = false) {
  status.textContent = text;
  status.className = isError ? 'error' : '';
}

async function refresh() {
  const res = await chrome.runtime.sendMessage({ type: 'bskyx:status' });
  form.hidden = !!res.loggedIn;
  account.hidden = !res.loggedIn;
  document.getElementById('handle').textContent = res.handle ? `@${res.handle}` : '';
}

// Chrome closes the popup whenever it loses focus, so what was typed is kept
// in session storage (memory only, cleared when the browser closes).
const fields = ['identifier', 'password'].map((id) => document.getElementById(id));

async function restoreDraft() {
  const { loginDraft } = await chrome.storage.session.get('loginDraft');
  for (const field of fields) field.value = loginDraft?.[field.id] || '';
}

function saveDraft() {
  chrome.storage.session.set({
    loginDraft: Object.fromEntries(fields.map((field) => [field.id, field.value])),
  });
}

for (const field of fields) field.addEventListener('input', saveDraft);

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!APP_PASSWORD_FORMAT.test(document.getElementById('password').value.trim())) {
    setStatus('That is not an App Password (xxxx-xxxx-xxxx-xxxx). Do not enter your Bluesky password here.', true);
    return;
  }
  const button = form.querySelector('button');
  button.disabled = true;
  setStatus('Logging in…');
  const res = await chrome.runtime.sendMessage({
    type: 'bskyx:login',
    identifier: document.getElementById('identifier').value,
    password: document.getElementById('password').value,
  });
  button.disabled = false;
  if (res.ok) {
    form.reset();
    chrome.storage.session.remove('loginDraft');
    setStatus('Logged in. Reload x.com to see Bluesky posts.');
    refresh();
  } else {
    setStatus(res.message || res.error, true);
  }
});

document.getElementById('logout').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'bskyx:logout' });
  setStatus('Logged out.');
  refresh();
});

restoreDraft();
refresh();
