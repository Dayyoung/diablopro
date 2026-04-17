// Supabase Configuration
const SUPABASE_URL = 'https://ylriklajmfkqfrmtulyg.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlscmlrbGFqbWZrcWZybXR1bHlnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYzODk2MzQsImV4cCI6MjA5MTk2NTYzNH0.J5_7NGCsgyrB1oBAcso0QgguzR8L2HZtIqObObUp1JU';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ImgBB Configuration
const IMGBB_API_KEY = 'd7b8dcedc0328822f564b2f8907c486c';
const IMGBB_API_URL = 'https://api.imgbb.com/1/upload';

// Default Slot Positions (will be overridden if user has custom config)
let DEFAULT_SLOT_POSITIONS = [
    { id: 'weapon', top: 13.0, left: 64.8, width: 5.3, height: 20.0 },
    { id: 'helm', top: 9.8, left: 74.2, width: 5.1, height: 10.4 },
    { id: 'armor', top: 23.0, left: 74.1, width: 5.3, height: 15.4 },
    { id: 'amulet', top: 19.2, left: 80.2, width: 2.4, height: 5.3 },
    { id: 'shield', top: 13.1, left: 83.3, width: 5.5, height: 20.4 },
    { id: 'ring1', top: 40.4, left: 70.7, width: 2.5, height: 5.7 },
    { id: 'belt', top: 41.6, left: 74.0, width: 5.2, height: 4.5 },
    { id: 'ring2', top: 40.8, left: 80.1, width: 2.4, height: 5.5 },
    { id: 'gloves', top: 36.6, left: 64.9, width: 5.2, height: 10.0 },
    { id: 'boots', top: 35.6, left: 83.5, width: 5.1, height: 10.6 },
];

let SLOT_POSITIONS = [...DEFAULT_SLOT_POSITIONS];

const slotState = {};
let userId = null;

const appContainer = document.getElementById('app-container');
const fileInput = document.getElementById('file-input');
const cropModal = document.getElementById('crop-modal');
const cropImage = document.getElementById('crop-image');
const viewerModal = document.getElementById('viewer-modal');
const viewerImage = document.getElementById('viewer-image');

let currentCropper = null;
let currentSlotId = null;
let isEditMode = false;
let isDeleteMode = false;
let isBackgroundMode = false;
let isViewOnly = false;
let dragState = null;

async function signInAnonymously() {
    const { data, error } = await sb.auth.signInAnonymously();
    if (error) {
        console.error('Anonymous sign in failed:', error);
        return null;
    }
    return data.user.id;
}

async function init() {
    const isMobile = window.innerWidth <= 768;
    const urlParams = new URLSearchParams(window.location.search);
    const sharedUserId = urlParams.get('user');
    
    if (sharedUserId) {
        userId = sharedUserId;
        isViewOnly = true;
        setTimeout(hideEditingUI, 0); // Wait for DOM if needed, though script is at end
    } else {
        const { data: { session } } = await sb.auth.getSession();
        if (session?.user) {
            userId = session.user.id;
        } else {
            userId = await signInAnonymously();
        }
    }
    
    await loadConfig();
    await loadSavedImages();
    createSlots();
    setupEventListeners();
    await loadBackground();
    
    if (isMobile) {
        const wrap = document.getElementById('app-wrapper');
        if (wrap) {
            wrap.scrollLeft = (wrap.scrollWidth - wrap.clientWidth) / 2;
        }
    }

    // Hide splash screen after 1.5 seconds
    const splash = document.getElementById('splash-screen');
    if (splash) {
        setTimeout(() => {
            splash.style.opacity = '0';
            splash.style.visibility = 'hidden';
            setTimeout(() => splash.remove(), 1000);
        }, 1500);
    }
}

async function loadConfig() {
    if (!userId) return;
    try {
        const { data, error } = await sb
            .from('user_configs')
            .select('config_data')
            .eq('user_id', userId)
            .eq('config_key', 'slot_positions')
            .single();

        if (error && error.code !== 'PGRST116') {
            console.error('Failed to load slots config:', error);
            // Fallback: check localStorage for legacy/failover
            const local = localStorage.getItem(`slots_${userId}`);
            if (local) SLOT_POSITIONS = JSON.parse(local);
            return;
        }

        if (data && data.config_data) {
            SLOT_POSITIONS = data.config_data;
        }
    } catch (err) {
        console.error('Error loading config:', err);
    }
}

async function saveConfig() {
    if (!userId || isViewOnly) return;
    try {
        // Always update localStorage as backup
        localStorage.setItem(`slots_${userId}`, JSON.stringify(SLOT_POSITIONS));
        
        const { error } = await sb
            .from('user_configs')
            .upsert({
                user_id: userId,
                config_key: 'slot_positions',
                config_data: SLOT_POSITIONS,
                updated_at: new Date().toISOString()
            }, { onConflict: 'user_id,config_key' });

        if (error) {
            console.error('Failed to save slots config to Supabase:', error);
        }
    } catch (err) {
        console.error('Error saving config:', err);
    }
}

function hideEditingUI() {
    const selectors = [
        '#edit-btn', 
        '#delete-slot-btn', 
        'button[onclick="addSlot()"]', 
        'button[onclick="changeBackground()"]',
        '#delete-btn'
    ];
    selectors.forEach(sel => {
        const el = document.querySelector(sel);
        if (el) el.style.display = 'none';
    });
    
    const newBtn = document.getElementById('new-profile-btn');
    if (newBtn) newBtn.style.display = 'flex';
}

sb.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN' && session?.user) {
        userId = session.user.id;
        loadSavedImages();
    }
});

async function loadSavedImages() {
    if (!userId) return;
    
    try {
        const { data, error } = await sb
            .from('user_slot_images')
            .select('slot_id, image_url')
            .eq('user_id', userId);

        if (error) {
            console.error('Failed to load saved images:', error);
            return;
        }

        if (data && data.length > 0) {
            data.forEach(row => {
                if (row.slot_id && row.image_url) {
                    slotState[row.slot_id] = { uploaded: true, imageUrl: row.image_url };
                }
            });
        }
    } catch (err) {
        console.error('Error loading saved images:', err);
    }
}

async function loadBackground() {
    if (!userId) return;
    try {
        const { data, error } = await sb
            .from('user_slot_images')
            .select('image_url')
            .eq('user_id', userId)
            .eq('slot_id', 'background')
            .single();

        if (error && error.code !== 'PGRST116') { // PGRST116 is 'no rows'
            console.error('Failed to load background:', error);
            return;
        }

        if (data && data.image_url) {
            appContainer.style.backgroundImage = `url('${data.image_url}')`;
        }
    } catch (err) {
        console.error('Error loading background:', err);
    }
}

function createSlots() {
    appContainer.querySelectorAll('.slot').forEach(slot => slot.remove());

    SLOT_POSITIONS.forEach(slotData => {
        const slot = document.createElement('div');
        slot.className = 'slot' + (isEditMode ? ' edit-mode' : '');
        slot.id = `slot-${slotData.id}`;
        slot.dataset.slotId = slotData.id;
        slot.style.top = `${slotData.top}%`;
        slot.style.left = `${slotData.left}%`;
        slot.style.width = `${slotData.width}%`;
        slot.style.height = `${slotData.height}%`;

        if (isEditMode) {
            const handle = document.createElement('div');
            handle.className = 'resize-handle';
            slot.appendChild(handle);
        }

        // Restore state
        if (slotState[slotData.id] && slotState[slotData.id].uploaded) {
            slot.classList.add('uploaded');
        } else {
            slotState[slotData.id] = { uploaded: false, imageUrl: null };
        }
        if (slotData.isNew) {
            slot.classList.add('new-slot');
            delete slotData.isNew;
        }

        appContainer.appendChild(slot);
    });

    // Setup drag listeners if in edit mode
    if (isEditMode) {
        document.querySelectorAll('.slot').forEach(slot => {
            const startHandler = e => {
                if (!isEditMode) return;
                // Don't preventDefault if not in edit mode or clicking buttons
                if (e.target.closest('button')) return;
                
                if (e.target.classList.contains('resize-handle')) {
                    startDrag(e, slot, 'resize');
                } else {
                    startDrag(e, slot, 'move');
                }
            };
            slot.addEventListener('mousedown', startHandler);
            slot.addEventListener('touchstart', startHandler, { passive: false });
        });
    }
}

function setupEventListeners() {
    fileInput.addEventListener('change', handleFileSelect);
    document.getElementById('close-crop').addEventListener('click', closeCropModal);
    document.getElementById('cancel-crop').addEventListener('click', closeCropModal);
    document.getElementById('confirm-upload').addEventListener('click', uploadCroppedImage);
    document.getElementById('close-viewer').addEventListener('click', closeViewerModal);
    viewerModal.addEventListener('click', e => { if (e.target === viewerModal) closeViewerModal(); });
    
    function switchView(direction) {
        const wrapper = document.getElementById('app-wrapper');
        wrapper.style.transition = 'transform 0.3s ease-in-out';
        wrapper.style.transform = direction === 'left' ? 'translateX(0)' : 'translateX(-100vw)';
    }
    const wrapper = document.getElementById('app-wrapper');
    if (wrapper) {
        wrapper.addEventListener('scroll', () => {
            const scrollX = wrapper.scrollLeft;
            console.log('Scroll X:', scrollX);
        });
    }

    document.addEventListener('click', handleSlotClick);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeCropModal(); closeViewerModal(); } });
    
    // Mouse events
    document.addEventListener('mousemove', handleDrag);
    document.addEventListener('mouseup', stopDrag);
    
    // Touch events for mobile dragging
    document.addEventListener('touchmove', handleDrag, { passive: false });
    document.addEventListener('touchend', stopDrag);
}

function handleSlotClick(e) {
    const slot = e.target.closest('.slot');
    if (!slot) return;

    const deleteBtn = e.target.closest('.delete-btn');
    if (deleteBtn) {
        if (isViewOnly) return;
        e.stopPropagation();
        deleteSlotImage(slot.dataset.slotId);
        return;
    }

    if (e.target.classList.contains('resize-handle')) {
        e.stopPropagation();
        return;
    }

    const slotId = slot.dataset.slotId;
    const state = slotState[slotId];

    if (isDeleteMode) {
        if (isViewOnly) return;
        if (confirm('이 슬롯을 삭제하시겠습니까?')) {
            removeSlotById(slotId);
            toggleDeleteMode();
        }
        return;
    }

    if (isEditMode) return;

    if (isViewOnly) {
        if (state.uploaded) {
            showFloatingPreview(slot, slotId, state.imageUrl);
        }
        return;
    }

    if (state.uploaded) {
        showFloatingPreview(slot, slotId, state.imageUrl);
    } else {
        currentSlotId = slotId;
        fileInput.click();
    }
}

function showFloatingPreview(slot, slotId, imageUrl) {
    const preview = document.createElement('div');
    preview.className = 'floating-preview';
    
    const img = document.createElement('img');
    img.src = imageUrl;
    preview.appendChild(img);

    if (!isViewOnly) {
        const delBtn = document.createElement('button');
        delBtn.className = 'preview-delete-btn';
        delBtn.innerHTML = '<i class="fas fa-trash-alt"></i>';
        delBtn.title = '이미지 삭제';
        delBtn.onclick = (e) => {
            e.stopPropagation();
            if (confirm('이 이미지를 삭제하시겠습니까?')) {
                deleteSlotImage(slotId);
                preview.remove();
            }
        };
        preview.appendChild(delBtn);
    }
    
    document.body.appendChild(preview);
    
    const slotRect = slot.getBoundingClientRect();
    const isMobile = window.innerWidth <= 768;
    
    if (isMobile) {
        preview.classList.add('mobile-preview');
        // Mobile: Center in screen
        preview.style.width = 'min(300px, 90vw)';
        preview.style.left = '50%';
        preview.style.top = '50%';
        preview.style.transform = 'translate(-50%, -50%)';
    } else {
        // Desktop: Align below slot
        const previewWidth = Math.max(300, slotRect.width * 3);
        preview.style.width = `${previewWidth}px`;
        preview.style.left = `${slotRect.left + slotRect.width / 2 - previewWidth / 2}px`;
        preview.style.top = `${slotRect.bottom + 10}px`;
    }
    
    // Close on click outside
    const closePreview = () => {
        preview.classList.add('fade-out');
        setTimeout(() => preview.remove(), 200);
        document.removeEventListener('click', closePreview);
    };
    
    setTimeout(() => {
        document.addEventListener('click', (e) => {
            if (!preview.contains(e.target) && e.target !== slot) {
                closePreview();
            }
        });
    }, 10);
}

function handleFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        alert('이미지 파일만 업로드 가능합니다.');
        return;
    }

    const reader = new FileReader();
    reader.onload = e => openCropModal(e.target.result);
    reader.readAsDataURL(file);
    fileInput.value = '';
}

function openCropModal(imageUrl) {
    cropImage.src = imageUrl;
    cropModal.style.display = 'flex';
    cropModal.style.flexDirection = 'column';
    cropModal.style.justifyContent = 'center';
    cropModal.style.alignItems = 'center';

    if (currentCropper) currentCropper.destroy();

    setTimeout(() => {
        currentCropper = new Cropper(cropImage, {
            aspectRatio: NaN,
            viewMode: 1,
            dragMode: 'move',
            autoCropArea: 0.8,
            restore: false,
            guides: true,
            center: true,
            highlight: false,
            cropBoxMovable: true,
            cropBoxResizable: true,
            toggleDragModeOnDblclick: false,
            touchZoomEnabled: true,
            pinchToZoomEnabled: true,
            mouseWheelZoomEnabled: true,
            keyboardEnabled: true,
            responsive: true,
            modal: true,
            dashed: true,
            movable: true,
            rotatable: true,
            scalable: true,
            zoomable: true,
            zoomOnTouch: true,
            zoomOnWheel: true,
            minContainerWidth: 300,
            minContainerHeight: 300
        });
    }, 100);
}

function closeCropModal() {
    cropModal.style.display = 'none';
    if (currentCropper) { currentCropper.destroy(); currentCropper = null; }
    cropImage.src = '';
    isBackgroundMode = false;
}

async function uploadCroppedImage() {
    if (!currentCropper) { alert('크롭된 이미지가 없습니다.'); return; }

    const uploadBtn = document.getElementById('confirm-upload');
    uploadBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 업로드 중...';
    uploadBtn.disabled = true;

    try {
        const canvas = currentCropper.getCroppedCanvas({ maxWidth: 2048, maxHeight: 2048, imageSmoothingEnabled: true, imageSmoothingQuality: 'high' });
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 1.0));
        const formData = new FormData();
        formData.append('image', blob);

        const response = await fetch(`${IMGBB_API_URL}?key=${IMGBB_API_KEY}`, {
            method: 'POST',
            body: formData
        });

        const data = await response.json();

        if (data.success) {
            const imageUrl = data.data.url;
            if (isBackgroundMode) {
                appContainer.style.backgroundImage = `url('${imageUrl}')`;
                await saveImageToSupabase('background', imageUrl);
                isBackgroundMode = false;
            } else {
                updateSlotState(currentSlotId, imageUrl);
                await saveImageToSupabase(currentSlotId, imageUrl);
            }
            closeCropModal();
        } else {
            throw new Error(data.error?.message || '업로드 실패');
        }
    } catch (error) {
        console.error('Upload error:', error);
        alert('업로드 실패: ' + error.message);
    } finally {
        uploadBtn.innerHTML = '<i class="fas fa-upload"></i> 업로드';
        uploadBtn.disabled = false;
    }
}
function updateSlotState(slotId, imageUrl) {
    const slot = document.getElementById(`slot-${slotId}`);
    slotState[slotId] = { uploaded: true, imageUrl };
    slot.classList.add('uploaded');
}

async function saveImageToSupabase(slotId, imageUrl) {
    if (!userId) return;
    try {
        const { error } = await sb
            .from('user_slot_images')
            .upsert({
                user_id: userId,
                slot_id: slotId,
                image_url: imageUrl,
                updated_at: new Date().toISOString()
            }, {
                onConflict: 'user_id,slot_id'
            });

        if (error) {
            console.error('Failed to save image to Supabase:', error);
        }
    } catch (err) {
        console.error('Error saving image:', err);
    }
}

async function deleteSlotImage(slotId) {
    if (!userId) return;
    const slot = document.getElementById(`slot-${slotId}`);
    slotState[slotId] = { uploaded: false, imageUrl: null };

    slot.classList.remove('uploaded');
    slot.querySelector('.slot-bg')?.remove();
    slot.querySelector('.delete-btn')?.remove();

    try {
        await sb
            .from('user_slot_images')
            .delete()
            .eq('user_id', userId)
            .eq('slot_id', slotId);
    } catch (err) {
        console.error('Error deleting image:', err);
    }
}

function openViewerModal(imageUrl) {
    viewerImage.src = imageUrl;
    viewerModal.style.display = 'block';
    document.body.style.overflow = 'hidden';
}

function closeViewerModal() {
    viewerModal.style.display = 'none';
    document.body.style.overflow = 'auto';
}

function getEventCoords(e) {
    if (e.touches && e.touches.length > 0) {
        return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
    return { x: e.clientX, y: e.clientY };
}

function startDrag(e, slot, type) {
    if (!isEditMode) return;
    
    const coords = getEventCoords(e);
    const rect = appContainer.getBoundingClientRect();
    
    dragState = {
        type,
        slot,
        startX: coords.x,
        startY: coords.y,
        startTop: parseFloat(slot.style.top),
        startLeft: parseFloat(slot.style.left),
        startWidth: parseFloat(slot.style.width),
        startHeight: parseFloat(slot.style.height),
        containerWidth: rect.width,
        containerHeight: rect.height
    };
    
    if (e.type === 'touchstart') {
        // Prevent scrolling while dragging on mobile
        e.preventDefault();
    }
}

function handleDrag(e) {
    if (!dragState) return;

    // Prevent scrolling while dragging
    if (e.cancelable) e.preventDefault();

    const coords = getEventCoords(e);
    const { type, slot, startX, startY, startTop, startLeft, startWidth, startHeight, containerWidth, containerHeight } = dragState;

    const deltaX = coords.x - startX;
    const deltaY = coords.y - startY;

    const deltaXPercent = (deltaX / containerWidth) * 100;
    const deltaYPercent = (deltaY / containerHeight) * 100;

    if (type === 'move') {
        slot.style.top = `${startTop + deltaYPercent}%`;
        slot.style.left = `${startLeft + deltaXPercent}%`;
    } else if (type === 'resize') {
        const newWidth = Math.max(2, startWidth + deltaXPercent);
        const newHeight = Math.max(2, startHeight + deltaYPercent);
        slot.style.width = `${newWidth}%`;
        slot.style.height = `${newHeight}%`;
    }
}

function stopDrag() {
    if (!dragState) return;

    const slot = dragState.slot;
    const id = slot.dataset.slotId;
    const pos = SLOT_POSITIONS.find(p => p.id === id);

    if (pos) {
        pos.top = parseFloat(slot.style.top);
        pos.left = parseFloat(slot.style.left);
        pos.width = parseFloat(slot.style.width);
        pos.height = parseFloat(slot.style.height);
    }

    console.log(`{ id: '${id}', top: ${pos.top.toFixed(1)}, left: ${pos.left.toFixed(1)}, width: ${pos.width.toFixed(1)}, height: ${pos.height.toFixed(1)} },`);

    saveConfig(); // Save after repositioning/resizing
    dragState = null;
}

function toggleEditMode() {
    isEditMode = !isEditMode;
    const btn = document.getElementById('edit-btn');
    const instructions = document.getElementById('edit-instructions');

    if (isEditMode) {
        btn.innerHTML = '<i class="fas fa-check"></i><span>완료</span>';
        btn.classList.add('active-edit');
    } else {
        btn.innerHTML = '<i class="fas fa-edit"></i><span>수정</span>';
        btn.classList.remove('active-edit');
    }

    createSlots();
}

function toggleDeleteMode() {
    isDeleteMode = !isDeleteMode;
    const btn = document.getElementById('delete-btn');
    if (isDeleteMode) {
        btn.classList.add('active-delete');
        if (isEditMode) toggleEditMode();
    } else {
        btn.classList.remove('active-delete');
    }
}

function addSlot() {
    const id = 'item_' + Math.random().toString(36).substr(2, 9);
    
    // Calculate height to be square in pixels (W * 2.165)
    const width = 5.0;
    const height = (width * (2436 / 1125));
    
    SLOT_POSITIONS.push({ id, top: 40, left: 40, width, height, isNew: true });
    saveConfig();
    createSlots();
}

function removeSlotById(id) {
    const index = SLOT_POSITIONS.findIndex(p => p.id === id);
    if (index === -1) return;

    SLOT_POSITIONS.splice(index, 1);
    delete slotState[id];
    saveConfig();
    createSlots();
}

function exportConfig() {
    console.log('SLOT_POSITIONS = [');
    SLOT_POSITIONS.forEach(pos => {
        console.log(`    { id: '${pos.id}', top: ${pos.top.toFixed(1)}, left: ${pos.left.toFixed(1)}, width: ${pos.width.toFixed(1)}, height: ${pos.height.toFixed(1)} },`);
    });
    console.log('];');
}

function changeBackground() {
    isBackgroundMode = true;
    fileInput.click();
}

document.addEventListener('DOMContentLoaded', init);

window.toggleEditMode = toggleEditMode;
window.toggleDeleteMode = toggleDeleteMode;
window.addSlot = addSlot;
window.exportConfig = exportConfig;
window.changeBackground = changeBackground;

function shareProfile() {
    if (!userId) return;
    const url = `${window.location.origin}${window.location.pathname}?user=${userId}`;
    navigator.clipboard.writeText(url).then(() => {
        alert('공유 링크가 클립보드에 복사되었습니다.');
    }).catch(err => {
        console.error('Failed to copy: ', err);
    });
}

function createNewProfile() {
    window.location.href = window.location.origin + window.location.pathname;
}

function switchView(view) {
    const wrap = document.getElementById('app-wrapper');
    if (!wrap) return;
    
    if (view === 'left') {
        wrap.scrollBy({ left: -wrap.clientWidth, behavior: 'smooth' });
    } else if (view === 'home') {
        const center = (wrap.scrollWidth - wrap.clientWidth) / 2;
        wrap.scrollTo({ left: center, behavior: 'smooth' });
    } else {
        wrap.scrollBy({ left: wrap.clientWidth, behavior: 'smooth' });
    }
}

window.shareProfile = shareProfile;
window.switchView = switchView;
window.createNewProfile = createNewProfile;

async function createNewProfile() {
    // Force a new anonymous session by signing out first
    if (sb && sb.auth) {
        await sb.auth.signOut();
    }
    // Redirect to root without URL parameters
    window.location.href = window.location.origin + window.location.pathname;
}
