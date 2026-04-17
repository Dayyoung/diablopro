// Supabase Configuration
const SUPABASE_URL = 'https://ylriklajmfkqfrmtulyg.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlscmlrbGFqbWZrcWZybXR1bHlnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYzODk2MzQsImV4cCI6MjA5MTk2NTYzNH0.J5_7NGCsgyrB1oBAcso0QgguzR8L2HZtIqObObUp1JU';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ImgBB Configuration
const IMGBB_API_KEY = 'd7b8dcedc0328822f564b2f8907c486c';
const IMGBB_API_URL = 'https://api.imgbb.com/1/upload';

const SLOT_POSITIONS = [
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
let isBackgroundMode = false;
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
    const { data: { session } } = await sb.auth.getSession();
    if (session?.user) {
        userId = session.user.id;
    } else {
        userId = await signInAnonymously();
    }
    
    createSlots();
    setupEventListeners();
    await loadSavedImages();
    await loadBackground();
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
                    const slot = document.getElementById(`slot-${row.slot_id}`);
                    if (slot) {
                        slot.classList.add('uploaded');
                        const img = document.createElement('img');
                        img.className = 'slot-bg';
                        img.src = row.image_url;
                        img.alt = 'Item';
                        slot.appendChild(img);
                        const deleteBtn = document.createElement('button');
                        deleteBtn.className = 'delete-btn';
                        deleteBtn.innerHTML = '<i class="fas fa-times"></i>';
                        deleteBtn.title = '이미지 삭제';
                        slot.appendChild(deleteBtn);
                    }
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

        slotState[slotData.id] = { uploaded: false, imageUrl: null };
        appContainer.appendChild(slot);
    });
}

function setupEventListeners() {
    fileInput.addEventListener('change', handleFileSelect);
    document.getElementById('close-crop').addEventListener('click', closeCropModal);
    document.getElementById('cancel-crop').addEventListener('click', closeCropModal);
    document.getElementById('confirm-upload').addEventListener('click', uploadCroppedImage);
    document.getElementById('close-viewer').addEventListener('click', closeViewerModal);
    viewerModal.addEventListener('click', e => { if (e.target === viewerModal) closeViewerModal(); });
    appContainer.addEventListener('click', handleSlotClick);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeCropModal(); closeViewerModal(); } });
    document.addEventListener('mousemove', handleDrag);
    document.addEventListener('mouseup', stopDrag);
}

function handleSlotClick(e) {
    const slot = e.target.closest('.slot');
    if (!slot) return;

    const deleteBtn = e.target.closest('.delete-btn');
    if (deleteBtn) {
        e.stopPropagation();
        deleteSlotImage(slot.dataset.slotId);
        return;
    }

    if (e.target.classList.contains('resize-handle')) {
        e.stopPropagation();
        return;
    }

    if (isEditMode) return;

    const slotId = slot.dataset.slotId;
    const state = slotState[slotId];

    if (state.uploaded) {
        openViewerModal(state.imageUrl);
    } else {
        currentSlotId = slotId;
        fileInput.click();
    }
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

    const img = document.createElement('img');
    img.className = 'slot-bg';
    img.src = imageUrl;
    img.alt = 'Item';
    slot.appendChild(img);

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-btn';
    deleteBtn.innerHTML = '<i class="fas fa-times"></i>';
    deleteBtn.title = '이미지 삭제';
    slot.appendChild(deleteBtn);
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

function startDrag(e, slot, type) {
    if (!isEditMode) return;
    e.preventDefault();
    e.stopPropagation();

    const rect = appContainer.getBoundingClientRect();
    dragState = {
        type,
        slot,
        startX: e.clientX,
        startY: e.clientY,
        startTop: parseFloat(slot.style.top),
        startLeft: parseFloat(slot.style.left),
        startWidth: parseFloat(slot.style.width),
        startHeight: parseFloat(slot.style.height),
        containerWidth: rect.width,
        containerHeight: rect.height
    };
}

function handleDrag(e) {
    if (!dragState) return;

    const { type, slot, startX, startY, startTop, startLeft, startWidth, startHeight, containerWidth, containerHeight } = dragState;

    const deltaX = e.clientX - startX;
    const deltaY = e.clientY - startY;

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

    dragState = null;
}

function toggleEditMode() {
    isEditMode = !isEditMode;
    const btn = document.getElementById('edit-btn');
    const instructions = document.getElementById('edit-instructions');

    if (isEditMode) {
        btn.innerHTML = '<i class="fas fa-check"></i> 편집 완료';
        btn.style.background = '#22c55e';
        instructions.style.display = 'block';
    } else {
        btn.innerHTML = '<i class="fas fa-edit"></i> 위치 조정';
        btn.style.background = '#ffd700';
        instructions.style.display = 'none';
    }

    createSlots();

    document.querySelectorAll('.slot').forEach(slot => {
        slot.addEventListener('mousedown', e => {
            if (!isEditMode) return;
            if (e.target.classList.contains('resize-handle')) {
                startDrag(e, slot, 'resize');
            } else {
                startDrag(e, slot, 'move');
            }
        });
    });
}

function addSlot() {
    const id = prompt('슬롯 ID를 입력하세요 (예: newSlot):');
    if (!id) return;
    if (SLOT_POSITIONS.find(p => p.id === id)) {
        alert('이미 존재하는 ID입니다.');
        return;
    }

    SLOT_POSITIONS.push({ id, top: 50, left: 50, width: 6, height: 6 });
    createSlots();
}

function removeSlot() {
    const id = prompt('삭제할 슬롯 ID를 입력하세요:');
    if (!id) return;

    const index = SLOT_POSITIONS.findIndex(p => p.id === id);
    if (index === -1) {
        alert('존재하지 않는 슬롯입니다.');
        return;
    }

    SLOT_POSITIONS.splice(index, 1);
    delete slotState[id];
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
window.addSlot = addSlot;
window.removeSlot = removeSlot;
window.exportConfig = exportConfig;
window.changeBackground = changeBackground;
