const tableBody = document.getElementById('links-table-body');
const totalLinksEl = document.getElementById('total-links');
const healthyLinksEl = document.getElementById('healthy-links');
const downLinksEl = document.getElementById('down-links');
const downAlertEl = document.getElementById('down-alert');
const addLinkForm = document.getElementById('add-link-form');
const alarmAudio = document.getElementById('alarm-audio');
const pageSizeEl = document.getElementById('page-size');
const pagePrevEl = document.getElementById('page-prev');
const pageNextEl = document.getElementById('page-next');
const pageInfoEl = document.getElementById('page-info');
const toastEl = document.getElementById('toast');
const filterCategoryEl = document.getElementById('filter-category');
const filterStatusEl = document.getElementById('filter-status');
const addRemarksEl = document.getElementById('add-remarks');
const remarksRowEl = document.getElementById('remarks-row');
const editModalEl = document.getElementById('edit-link-modal');
const editLinkForm = document.getElementById('edit-link-form');
const editLinkIdEl = document.getElementById('edit-link-id');
const editLinkUrlEl = document.getElementById('edit-link-url');
const editLinkCategoryEl = document.getElementById('edit-link-category');
const editLinkNoteEl = document.getElementById('edit-link-note');
const editLinkCancelEl = document.getElementById('edit-link-cancel');

let lastDownState = false;
let filterCategory = 'all';
let filterStatus = 'all';
let linksCache = [];
let currentPage = 1;
let pageSize = Number(pageSizeEl?.value || 10);
let toastTimer = null;

function formatTimestamp(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString();
}

function statusClass(status) {
  if (status === 'healthy') return 'status-healthy';
  if (status === 'down') return 'status-down';
  if (status === 'warning') return 'status-warning';
  return 'status-unknown';
}

async function fetchLinks() {
  const params = new URLSearchParams();
  if (filterCategory !== 'all') params.set('category', filterCategory);
  if (filterStatus !== 'all') params.set('status', filterStatus);
  const qs = params.toString();
  const url = qs ? `/links?${qs}` : '/links';
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('Failed to fetch links');
  }
  return response.json();
}

async function deleteLink(id) {
  const response = await fetch(`/links/${id}`, { method: 'DELETE' });
  if (!response.ok) {
    throw new Error('Failed to delete link');
  }
}

async function markLinkChecked(id) {
  const response = await fetch(`/links/${id}/checked`, { method: 'POST' });
  if (!response.ok) {
    throw new Error('Failed to mark link as checked');
  }
}

async function updateLink(id, body) {
  const response = await fetch(`/links/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to update link');
  }
}

function openEditModal(link) {
  if (!editLinkIdEl || !editLinkUrlEl || !editLinkCategoryEl || !editLinkNoteEl || !editModalEl) return;
  editLinkIdEl.value = String(link.id);
  editLinkUrlEl.value = link.url || '';
  editLinkCategoryEl.value = link.category || '';
  editLinkNoteEl.value = link.note || '';
  editModalEl.classList.remove('hidden');
  editModalEl.setAttribute('aria-hidden', 'false');
}

function closeEditModal() {
  if (!editModalEl) return;
  editModalEl.classList.add('hidden');
  editModalEl.setAttribute('aria-hidden', 'true');
}

function showToast(message) {
  if (!toastEl) return;

  toastEl.textContent = message;
  toastEl.classList.remove('hidden');
  toastEl.classList.add('show');

  if (toastTimer) {
    clearTimeout(toastTimer);
  }

  toastTimer = setTimeout(() => {
    toastEl.classList.remove('show');
    toastEl.classList.add('hidden');
  }, 2200);
}

function renderTable(links) {
  tableBody.innerHTML = '';

  for (const link of links) {
    const tr = document.createElement('tr');

    const urlTd = document.createElement('td');
    urlTd.setAttribute('data-label', 'URL');
    const urlAnchor = document.createElement('a');
    urlAnchor.href = link.url;
    urlAnchor.target = '_blank';
    urlAnchor.rel = 'noreferrer noopener';
    urlAnchor.textContent = link.url;
    urlTd.appendChild(urlAnchor);

    const categoryTd = document.createElement('td');
    categoryTd.setAttribute('data-label', 'Group');
    categoryTd.textContent = link.category || '-';

    const noteTd = document.createElement('td');
    noteTd.setAttribute('data-label', 'Note');
    noteTd.textContent = link.note || '-';

    const statusTd = document.createElement('td');
    statusTd.className = 'status-cell';
    statusTd.setAttribute('data-label', 'Status');
    const statusBadge = document.createElement('span');
    statusBadge.className = `status-badge ${statusClass(link.status)}`;
    statusBadge.textContent = link.status || 'unknown';
    statusTd.appendChild(statusBadge);

    const checkedTd = document.createElement('td');
    checkedTd.setAttribute('data-label', 'Last Checked');
    checkedTd.textContent = formatTimestamp(link.last_checked);

    const actionTd = document.createElement('td');
    actionTd.setAttribute('data-label', 'Actions');
    const actionGroup = document.createElement('div');
    actionGroup.className = 'action-group';

    const editBtn = document.createElement('button');
    editBtn.className = 'edit';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => openEditModal(link));
    actionGroup.appendChild(editBtn);

    if (link.status === 'down') {
      const checkedBtn = document.createElement('button');
      checkedBtn.className = 'checked';
      checkedBtn.textContent = 'Checked';
      checkedBtn.addEventListener('click', async () => {
        try {
          await markLinkChecked(link.id);
          await refresh();
          showToast('Marked as healthy');
        } catch (error) {
          console.error(error);
          window.alert('Unable to mark link as checked.');
        }
      });
      actionGroup.appendChild(checkedBtn);
    }

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', async () => {
      const confirmed = window.confirm('Delete this link?');
      if (!confirmed) return;

      try {
        await deleteLink(link.id);
        await refresh();
      } catch (error) {
        console.error(error);
        window.alert('Unable to delete link.');
      }
    });
    actionGroup.appendChild(deleteBtn);
    actionTd.appendChild(actionGroup);

    tr.append(urlTd, categoryTd, noteTd, statusTd, checkedTd, actionTd);
    tableBody.appendChild(tr);
  }
}

function renderStats(links) {
  const total = links.length;
  const healthy = links.filter((l) => l.status === 'healthy').length;
  const down = links.filter((l) => l.status === 'down').length;

  totalLinksEl.textContent = String(total);
  healthyLinksEl.textContent = String(healthy);
  downLinksEl.textContent = String(down);

  const hasDown = down > 0;
  downAlertEl.classList.toggle('hidden', !hasDown);

  if (hasDown && !lastDownState) {
    alarmAudio.currentTime = 0;
    alarmAudio.play().catch((error) => {
      console.warn('Alarm playback was blocked by browser policy:', error.message);
    });
  }

  if (!hasDown) {
    alarmAudio.pause();
    alarmAudio.currentTime = 0;
  }

  lastDownState = hasDown;
}

function totalPages() {
  return Math.max(1, Math.ceil(linksCache.length / pageSize));
}

function pagedLinks() {
  const start = (currentPage - 1) * pageSize;
  return linksCache.slice(start, start + pageSize);
}

function renderPagination() {
  const pages = totalPages();
  pageInfoEl.textContent = `Page ${currentPage} / ${pages}`;
  pagePrevEl.disabled = currentPage <= 1;
  pageNextEl.disabled = currentPage >= pages;
}

function renderCurrentPage() {
  renderTable(pagedLinks());
  renderPagination();
}

async function refresh() {
  try {
    linksCache = await fetchLinks();
    renderStats(linksCache);

    const pages = totalPages();
    if (currentPage > pages) {
      currentPage = pages;
    }

    renderCurrentPage();
  } catch (error) {
    console.error(error);
  }
}

if (addRemarksEl && remarksRowEl) {
  remarksRowEl.classList.add('hidden');
  addRemarksEl.checked = false;
  addRemarksEl.addEventListener('change', () => {
    remarksRowEl.classList.toggle('hidden', !addRemarksEl.checked);
  });
}

addLinkForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const urlsInput = document.getElementById('new-urls').value;
  const category = document.getElementById('new-category')?.value;
  const noteEl = document.getElementById('new-note');
  const addRemarks = document.getElementById('add-remarks')?.checked;
  const note = addRemarks && noteEl ? noteEl.value.trim() : '';

  const urls = [...new Set(urlsInput.split(/\r?\n|,/).map((value) => value.trim()).filter(Boolean))];

  if (urls.length === 0) return;
  if (!category) {
    window.alert('Please select a group.');
    return;
  }

  try {
    const response = await fetch('/links/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls, note: note || undefined, category })
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const invalidDetails = Array.isArray(payload.invalidUrls) ? `\nInvalid:\n${payload.invalidUrls.join('\n')}` : '';
      const unresolvedDetails = Array.isArray(payload.unresolvedUrls)
        ? `\nUnreachable (https->http failed):\n${payload.unresolvedUrls.join('\n')}`
        : '';
      const details = `${invalidDetails}${unresolvedDetails}`;
      throw new Error(payload.error ? `${payload.error}${details}` : 'Failed to create links');
    }

    addLinkForm.reset();
    if (remarksRowEl) remarksRowEl.classList.add('hidden');
    await refresh();
  } catch (error) {
    console.error(error);
    window.alert(`Unable to add links.\n${error.message}`);
  }
});

function applyFilters() {
  filterCategory = filterCategoryEl?.value || 'all';
  filterStatus = filterStatusEl?.value || 'all';
  currentPage = 1;
}

if (filterCategoryEl) {
  filterCategoryEl.addEventListener('change', () => {
    applyFilters();
    refresh();
  });
}
if (filterStatusEl) {
  filterStatusEl.addEventListener('change', () => {
    applyFilters();
    refresh();
  });
}

pageSizeEl.addEventListener('change', () => {
  pageSize = Number(pageSizeEl.value) || 10;
  currentPage = 1;
  renderCurrentPage();
});

pagePrevEl.addEventListener('click', () => {
  if (currentPage <= 1) return;
  currentPage -= 1;
  renderCurrentPage();
});

pageNextEl.addEventListener('click', () => {
  if (currentPage >= totalPages()) return;
  currentPage += 1;
  renderCurrentPage();
});

if (editLinkForm) {
  editLinkForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const id = Number(editLinkIdEl?.value);
    const url = editLinkUrlEl?.value?.trim();
    const category = editLinkCategoryEl?.value?.trim() || null;
    const note = editLinkNoteEl?.value?.trim() || null;
    if (!id || !url) return;
    try {
      await updateLink(id, { url, note, category });
      closeEditModal();
      await refresh();
      showToast('Link updated');
    } catch (error) {
      console.error(error);
      window.alert(error.message || 'Unable to update link.');
    }
  });
}

if (editLinkCancelEl) {
  editLinkCancelEl.addEventListener('click', closeEditModal);
}

if (editModalEl) {
  editModalEl.addEventListener('click', (e) => {
    if (e.target === editModalEl) closeEditModal();
  });
}

refresh();
setInterval(refresh, 30000);
