function getSlug(){
  const params = new URLSearchParams(window.location.search);
  return params.get("gallery")?.toLowerCase() || null;
}

const slug = getSlug();

// new json detection
let FOLDER_ID = null;

async function loadFolderConfig(){

  if(!slug){
    document.body.innerHTML = "<h2>Gallery not found</h2>";
    return;
  }

  try{
    const res = await fetch("https://script.google.com/macros/s/AKfycbyqYA9a3jYGkb03QQ0-IyCaqZQbKlumQjvJYCBlsrLepN-XlZ0AszNF1oLhAU_j093-zQ/exec?t=" + Date.now());
    const FOLDER_MAP = await res.json();

    const config = FOLDER_MAP[slug];

    if(!config){
      document.body.innerHTML = "<h2>Gallery not found</h2>";
      return;
    }

    FOLDER_ID = config.folder;

    const titleEl = document.getElementById("galleryTitle");
    if(titleEl && config.title){
      titleEl.textContent = config.title;
    }

    loadNextImages();

  }catch(err){
    console.error("Failed to load folders.json", err);
    document.body.innerHTML = "<h2>Config error</h2>";
  }
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
const batchLoader = document.getElementById("batchLoader");

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

// ------------------- util: extract number from filename -------------------
function extractNumber(name){
  // ambil nombor terakhir dalam nama (IMG_2024_2001.jpg → 2001)
  const matches = name.match(/\d+/g);
  return matches ? parseInt(matches[matches.length - 1], 10) : 0;
}

// ------------------- Load images -------------------
async function loadNextImages(){

  if(isLoading) return;
  isLoading = true;

  batchLoader.style.display = "block";

  const query = encodeURIComponent(
    `'${FOLDER_ID}' in parents and mimeType contains 'image/'`
  );

  let url =
    `https://www.googleapis.com/drive/v3/files?` +
    `q=${query}` +
    `&orderBy=name asc` + // desc for Z > A, asc for A > Z
    `&pageSize=${PAGE_SIZE}` +
    `&fields=nextPageToken,files(id,name)` +
    `&key=${API_KEY}`;

  if (nextPageToken) url += `&pageToken=${nextPageToken}`;

  const res = await fetch(url);
  const data = await res.json();

  nextPageToken = data.nextPageToken || null;

  if(!nextPageToken){
  scrollObserver.unobserve(document.getElementById("scrollSentinel"));
}

  const sorted = data.files
    .sort((a, b) => extractNumber(a.name) - extractNumber(b.name)); // rukar juga untuk sort

  await addImages(sorted);

  // reset button
  isLoading = false;
  batchLoader.style.display = "none";
}

// ------------------- Add image -------------------
let loadedImages = [];

function addImages(files){

  files.forEach(file=>{

    if(loadedImageSet.has(file.id)) return;
    loadedImageSet.add(file.id);

    const thumb = `https://lh3.googleusercontent.com/d/${file.id}=w600-h900-c-rw`;

    const item = {
      id: file.id,
      name: file.name,
      thumb: thumb,
      full: `https://lh3.googleusercontent.com/d/${file.id}`,
    };

    modalImageIds.push(item.id);
    loadedImages.push(item);

    renderGrid([item]);

  });
}

const imageObserver = new IntersectionObserver((entries, observer) => {
  entries.forEach(entry => {
    if(entry.isIntersecting){
      const img = entry.target;
      if(img.dataset.src){
        img.src = img.dataset.src;
      }
      observer.unobserve(img);
    }
  });
},{
  rootMargin: "200px"
});

function renderGrid(images){

  images.forEach(item=>{

    const wrapper = document.createElement("div");
    wrapper.className = "thumb";

    const img = document.createElement("img");
    img.dataset.src = item.thumb;
    img.loading = "lazy";
    img.classList.add("lazy-thumb");

    img.onload = ()=>{
      img.classList.add("loaded");
    };

    wrapper.appendChild(img);
    imageObserver.observe(img);

    wrapper.onclick = ()=>{
      if(!selectMode){
        openModal(item.id);
        return;
      }

      if(selectedIds.has(item.id)){
        selectedIds.delete(item.id);
        wrapper.classList.remove("selected");
      }else{
        selectedIds.add(item.id);
        wrapper.classList.add("selected");
      }

      multiCount.textContent = selectedIds.size;
    };

    gallery.appendChild(wrapper);
  });
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
};

function exitMultiMode(){
  selectMode = false;
  selectedIds.clear();

  multiBar.style.display = "none";
  selectBtn.style.display = "inline-block";

  document.querySelectorAll(".selected")
    .forEach(el=>el.classList.remove("selected"));
}

multiCancel.onclick = exitMultiMode;

const scrollObserver = new IntersectionObserver(entries => {
  if(entries[0].isIntersecting && nextPageToken && !isLoading){
    loadNextImages();
  }
},{
  rootMargin: "400px"
});
// ------------------- Init -------------------
loadFolderConfig();

const sentinel = document.getElementById("scrollSentinel");
scrollObserver.observe(sentinel);
