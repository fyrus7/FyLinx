function getSlug(){
  const params = new URLSearchParams(window.location.search);
  return params.get("g")?.toLowerCase() || null;
}

const FOLDER_MAP = {
  ijoikila: "1qEfxwXgPcvEPRlBKNNecsHaqFSRrAjTE",
  zureenyantt: "1xGqkPTjU9Z9eIXJWHrnFc8ebd3jadsKA"
};

const FOLDER_ID = FOLDER_MAP[slug];

if (!FOLDER_ID) {
  document.body.innerHTML = "<h2>Gallery not found</h2>";
  throw new Error("Invalid slug");
}

const API_KEY   = "AIzaSyCyL4jxLN9w87WG20GqeEIAaUCupjKmn8U";

let nextPageToken = null;
let isLoading = false;
const gallery = document.getElementById("imageGrid");
const modal = document.getElementById("modal");
const modalImg = document.getElementById("modalImg");
const selectBtn = document.getElementById("selectBtn");
let selectMode = false;
let selectedIds = new Set();
const downloadBtn = document.getElementById("downloadBtn");
const multiBar = document.getElementById("multiBar");
const multiDownload = document.getElementById("multiDownload");
const multiCancel = document.getElementById("multiCancel");
const multiCount = document.getElementById("multiCount");

let modalImageIds = [];
let currentIndex = 0;
const loadedImageSet = new Set();

// ------------------- Download ---------------------
async function downloadCurrentImage(){

  const fileId = modalImageIds[currentIndex];
  const fileName = loadedImages[currentIndex]?.name || "photo.jpg";

  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${API_KEY}`;

  try{

    // UI state: downloading
    downloadBtn.disabled = true;
    downloadBtn.textContent = "Downloading...";

    const response = await fetch(url);
    if(!response.ok) throw new Error("Network error");

    const blob = await response.blob();
    const blobUrl = window.URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    window.URL.revokeObjectURL(blobUrl);

    // UI state: done
    downloadBtn.textContent = "Downloaded";

    setTimeout(()=>{
      downloadBtn.textContent = "Download";
      downloadBtn.disabled = false;
    },1500);

  }catch(err){
    console.error("Download failed:", err);

    downloadBtn.textContent = "Failed";
    setTimeout(()=>{
      downloadBtn.textContent = "Download";
      downloadBtn.disabled = false;
    },1500);
  }
}

downloadBtn.addEventListener("click", e=>{
  e.stopPropagation(); // elak modal tertutup
  downloadCurrentImage();
});
// ------------------- MORE button -------------------
const moreBtn = document.createElement("button");
moreBtn.classList.add("btn-dark");
moreBtn.textContent = "More";
moreBtn.style.display = "block";
moreBtn.style.margin = "16px auto";
moreBtn.style.padding = "8px 16px";
moreBtn.style.fontSize = "12px";
gallery.after(moreBtn);

// ------------------- util: extract number from filename -------------------
function extractNumber(name){
  // ambil nombor terakhir dalam nama (IMG_2024_2001.jpg → 2001)
  const matches = name.match(/\d+/g);
  return matches ? parseInt(matches[matches.length - 1], 10) : 0;
}

// ------------------- Load images -------------------
async function loadNextImages(){

  if(isLoading) return; // elak double click
  isLoading = true;

  moreBtn.disabled = true;
  moreBtn.textContent = "Loading...";

  const query = encodeURIComponent(
    `'${FOLDER_ID}' in parents and mimeType contains 'image/'`
  );

  let url =
    `https://www.googleapis.com/drive/v3/files?` +
    `q=${query}` +
    `&orderBy=name desc` +
    `&pageSize=${PAGE_SIZE}` +
    `&fields=nextPageToken,files(id,name)` +
    `&key=${API_KEY}`;

  if (nextPageToken) url += `&pageToken=${nextPageToken}`;

  const res = await fetch(url);
  const data = await res.json();

  nextPageToken = data.nextPageToken || null;

  const sorted = data.files
    .sort((a, b) => extractNumber(b.name) - extractNumber(a.name));

  addImages(sorted);

  // reset button
  isLoading = false;
  moreBtn.disabled = false;
  moreBtn.textContent = "More";

  if(!nextPageToken){
   // moreBtn.style.display = "none";
    moreBtn.style.visibility = "hidden";
  }
}

// ------------------- Add image -------------------
let loadedImages = [];

function addImages(files){

  const preload = files.map(file => new Promise(resolve=>{
    const img = new Image();
    img.onload = ()=>{
      resolve({
        id: file.id,
        name: file.name,
        thumb: `https://drive.google.com/thumbnail?id=${file.id}&sz=w800`,
        full: `https://lh3.googleusercontent.com/d/${file.id}`,
        ratio: img.naturalWidth / img.naturalHeight
      });
    };
    img.src = `https://drive.google.com/thumbnail?id=${file.id}&sz=w800`;
  }));

  Promise.all(preload).then(images=>{

  // filter gambar yang belum pernah load
  const newImages = images.filter(img => {
    if(loadedImageSet.has(img.id)) return false;
    loadedImageSet.add(img.id);
    return true;
  });

  if(newImages.length === 0) return;

  newImages.forEach(img => modalImageIds.push(img.id));
  loadedImages = loadedImages.concat(newImages);
  renderJustified(newImages);
});
}


function renderJustified(images){

  const container = document.getElementById("imageGrid");
  const TARGET_ROW_HEIGHT = 220;
  const containerWidth = container.clientWidth;

  let row = [];
  let rowWidth = 0;

  function addRow(row, rowWidth){
    const rowDiv = document.createElement("div");
    rowDiv.className = "row";

    const scale = containerWidth / rowWidth;

    row.forEach(item=>{
      const img = document.createElement("img");
      img.src = item.thumb;
      img.style.height = `${TARGET_ROW_HEIGHT * scale}px`;
      img.style.width = `${TARGET_ROW_HEIGHT * scale * item.ratio}px`;

      img.onclick = ()=>{

        if(!selectMode){
          openModal(item.id);
          return;
        }
        
        if(selectedIds.has(item.id)){
          selectedIds.delete(item.id);
          img.classList.remove("selected");
        }else{
          selectedIds.add(item.id);
          img.classList.add("selected");
        }
        
        multiCount.textContent = selectedIds.size;
      };

      rowDiv.appendChild(img);
    });

    container.appendChild(rowDiv);
  }

  images.forEach(img=>{
    const scaledWidth = img.ratio * TARGET_ROW_HEIGHT;
    row.push(img);
    rowWidth += scaledWidth;

    if(rowWidth >= containerWidth){
      addRow(row, rowWidth);
      row = [];
      rowWidth = 0;
    }
  });

  if(row.length){
    addRow(row, rowWidth);
  }
}

// ------------------- Modal -------------------
function openModal(fileId){
  currentIndex = modalImageIds.indexOf(fileId);
  showModalImage(currentIndex);
  modal.style.display = "flex";

  document.body.classList.add("modal-open");
}

function showModalImage(newIndex){

  const total = modalImageIds.length;

  if(newIndex < 0) newIndex = total - 1;
  if(newIndex >= total) newIndex = 0;

  const diff = newIndex - currentIndex;

  let direction;

  if(diff === 1 || diff === -(total - 1)){
    direction = "right";
  } else {
    direction = "left";
  }

  modalImg.classList.add(
    direction === "right" ? "slide-out-left" : "slide-out-right"
  );

  setTimeout(()=>{

    currentIndex = newIndex;
    modalImg.src = `https://lh3.googleusercontent.com/d/${modalImageIds[newIndex]}`;

    modalImg.classList.remove("slide-out-left","slide-out-right");

    modalImg.classList.add(
      direction === "right" ? "slide-in-right" : "slide-in-left"
    );

    requestAnimationFrame(()=>{
      modalImg.classList.remove("slide-in-left","slide-in-right");
    });

  }, 300);
}

modal.addEventListener("click", e=>{
  if(e.target !== modalImg){
    modal.style.display = "none";
    document.body.classList.remove("modal-open");
  }
});

document.addEventListener("keydown", e=>{
  if(modal.style.display !== "flex") return;

  if(e.key === "ArrowRight"){
    showModalImage((currentIndex + 1) % modalImageIds.length);
  }

  if(e.key === "ArrowLeft"){
    showModalImage(
      (currentIndex - 1 + modalImageIds.length) % modalImageIds.length
    );
  }

  if(e.key === "Escape"){
    modal.style.display = "none";
    document.body.classList.remove("modal-open");
  }
});

let touchStartX = 0;
let touchEndX = 0;

modalImg.addEventListener("touchstart", e=>{
  touchStartX = e.touches[0].clientX;
});

modalImg.addEventListener("touchend", e=>{
  touchEndX = e.changedTouches[0].clientX;
  handleSwipe();
});

function handleSwipe(){
  const threshold = 60; // boleh adjust

  if(touchEndX - touchStartX > threshold){
    // swipe right
    showModalImage(
      (currentIndex - 1 + modalImageIds.length) % modalImageIds.length
    );
  }

  if(touchStartX - touchEndX > threshold){
    // swipe left
    showModalImage((currentIndex + 1) % modalImageIds.length);
  }
}

// ------- multi download -------
async function downloadMultiple(){

  multiDownload.disabled = true;
  multiDownload.textContent = "Downloading...";

  for(const fileId of selectedIds){

    const fileData = loadedImages.find(img => img.id === fileId);
    const fileName = fileData?.name || "photo.jpg";

    const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${API_KEY}`;

    try{
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      window.URL.revokeObjectURL(blobUrl);

      await new Promise(r => setTimeout(r, 400));

    }catch(err){
      console.error("Failed:", fileId);
    }
  }

  multiDownload.textContent = "Done ✓";

  setTimeout(()=>{
    multiDownload.textContent = "Download";
    multiDownload.disabled = false;
    exitMultiMode();
  },1500);
}

multiDownload.onclick = downloadMultiple;

selectBtn.onclick = ()=>{

  selectMode = true;
  selectedIds.clear();

  selectBtn.style.display = "none";
  multiBar.style.display = "flex";
  multiCount.textContent = 0;

//  moreBtn.style.display = "none";
  moreBtn.style.visibility = "hidden";
};

function exitMultiMode(){
  selectMode = false;
  selectedIds.clear();

  multiBar.style.display = "none";
  selectBtn.style.display = "inline-block";

  if(nextPageToken){
   // moreBtn.style.display = "block";
    moreBtn.style.visibility = "visible";
  }

  document.querySelectorAll(".selected")
    .forEach(el=>el.classList.remove("selected"));
}

multiCancel.onclick = exitMultiMode;

// ------------------- Init -------------------
moreBtn.onclick = loadNextImages;
loadNextImages();
