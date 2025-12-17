// 电子书阅读器应用

// 应用状态
const appState = {
    books: [],
    currentFolder: null,
    loading: false,
    currentBook: null,
    inRandomDisplayMode: true, // 默认进入随机阅读模式
    displayedBookId: null,
    // 自动滚动相关状态
    autoScroll: false,
    scrollSpeed: 20, // 滚动速度，单位ms，默认调整为更快
    scrollIntervalId: null,
    // 用于跟踪图书阅读顺序
    readBooksOrder: [],
    currentReadIndex: 0
};

// 获取DOM元素
const statusText = document.getElementById('statusText');
const booksContainer = document.getElementById('booksContainer');
const bookTemplate = document.getElementById('bookTemplate');

// 直接创建folderInput元素，而不是从模板中获取
const folderInput = document.createElement('input');
folderInput.type = 'file';
folderInput.id = 'folderInput';
folderInput.webkitdirectory = true;
folderInput.directory = true;
folderInput.multiple = true;
folderInput.style.display = 'none';

// 将folderInput添加到body中
document.body.appendChild(folderInput);

// 初始化应用
function initApp() {
    if (!bookTemplate) {
        console.error('Book template not found!');
        return;
    }
    setupEventListeners();
}

// 设置事件监听器
function setupEventListeners() {
    // 文件夹选择事件
    if (folderInput) {
        folderInput.addEventListener('change', handleFolderSelection);
    } else {
        console.error('Folder input element not available');
    }
    
    // 全局点击事件委托，处理所有按钮点击
    document.addEventListener('click', function(e) {
        // 处理随机阅读按钮点击
        if (e.target.id === 'randomDisplayBtn') {
            displayRandomBook();
        }
        // 处理随机章节按钮点击
        else if (e.target.id === 'randomChapterBtn') {
            randomizeCurrentBookChapter();
        }
        // 处理空状态区域点击，触发文件夹选择
        else if (e.target.classList.contains('empty-state') || (e.target.closest && e.target.closest('.empty-state'))) {
            if (folderInput) {
                folderInput.click();
            }
        }
        // 处理文件夹选择按钮点击
        else if (e.target.classList.contains('folder-select-btn-icon')) {
            if (folderInput) {
                folderInput.click();
            }
        }
        // 处理字体大小调整按钮点击
        else if (e.target.classList.contains('font-size-btn')) {
            const bookElement = e.target.closest('.book-item');
            if (bookElement) {
                const bookId = bookElement.dataset.bookId;
                const book = appState.books.find(b => b.id === bookId);
                if (book && book.pagesElement) {
                    if (e.target.classList.contains('decrease-font')) {
                        adjustFontSize(book, -1);
                    } else if (e.target.classList.contains('increase-font')) {
                        adjustFontSize(book, 1);
                    }
                }
            }
        }
    });
}

// 处理文件夹选择
async function handleFolderSelection(event) {
    const files = event.target.files;
    if (!files || !files.length) return;
    
    appState.loading = true;
    updateStatus('正在分析电子书...');
    booksContainer.innerHTML = '<div class="loading">正在加载电子书</div>';
    
    try {
        // 重置书籍列表
        appState.books = [];
        
        // 处理选择的文件和文件夹
        await processSelectedFiles(files);
        
        // 显示随机书籍
        displayRandomBook();
        
        updateStatus(`已加载 ${appState.books.length} 本电子书`);
    } catch (error) {
        console.error('处理文件夹时出错:', error);
        updateStatus('处理文件夹时出错');
        booksContainer.innerHTML = '<div class="empty-state"><p>处理文件夹时出错</p><p class="hint">请检查文件夹内容并重试</p></div>';
    } finally {
        appState.loading = false;
        // 清除input值，以便可以重新选择同一文件夹
        folderInput.value = '';
    }
}

// 处理选择的文件
async function processSelectedFiles(files) {
    // 按路径对文件进行分组，以便处理文件夹
    const filesByPath = {};
    
    // 首先对文件按路径分组
    for (const file of files) {
        if (!file || !file.name) continue;
        
        const path = file.webkitRelativePath;
        const folderPath = path.split('/').slice(0, -1).join('/');
        
        if (!filesByPath[folderPath]) {
            filesByPath[folderPath] = [];
        }
        filesByPath[folderPath].push(file);
    }
    
    // 跟踪已处理的解压EPUB文件夹，避免重复处理
    const processedUnzippedEpubFolders = new Set();
    
    // 1. 首先处理根目录和子目录中的所有EPUB和PDF文件
    for (const [folderPath, folderFiles] of Object.entries(filesByPath)) {
        for (const file of folderFiles) {
            if (!file || !file.name) continue;
            
            // 检查是否是EPUB文件
            if (file.name.endsWith('.epub')) {
                await processEpubFile(file);
            } 
            // 检查是否是PDF文件
            else if (file.name.endsWith('.pdf')) {
                await processPdfFile(file);
            }
        }
    }
    
    // 2. 然后处理已解压的EPUB文件夹
    // 遍历所有文件夹，找出可能是解压EPUB的顶级文件夹
    for (const [folderPath, folderFiles] of Object.entries(filesByPath)) {
        // 检查是否是已解压的EPUB文件夹
        const isUnzippedEpub = folderFiles.some(file => 
            file.name === 'mimetype' || 
            file.webkitRelativePath.includes('META-INF/') ||
            file.name === 'content.opf'
        );
        
        // 确保这是顶级解压文件夹（不是某个解压文件夹的子文件夹）
        let isTopLevelEpubFolder = true;
        const parentPath = folderPath.substring(0, folderPath.lastIndexOf('/'));
        if (parentPath) {
            // 检查父文件夹是否也是解压EPUB文件夹
            const parentFiles = filesByPath[parentPath];
            if (parentFiles && parentFiles.some(file => 
                file.name === 'mimetype' || 
                file.webkitRelativePath.includes('META-INF/') ||
                file.name === 'content.opf'
            )) {
                isTopLevelEpubFolder = false;
            }
        }
        
        // 如果是解压的EPUB文件夹且是顶级文件夹，并且未处理过，则处理它
        if (isUnzippedEpub && isTopLevelEpubFolder && !processedUnzippedEpubFolders.has(folderPath)) {
            // 标记为已处理
            processedUnzippedEpubFolders.add(folderPath);
            
            // 收集此解压EPUB的所有文件
            const epubFiles = [];
            
            // 遍历所有文件，找出属于这个解压EPUB的文件
            for (const file of files) {
                if (file.webkitRelativePath.startsWith(folderPath + '/') || 
                    file.webkitRelativePath === folderPath) {
                    epubFiles.push(file);
                }
            }
            
            await processUnzippedEpub(folderPath, epubFiles);
        }
    }
}

// 处理EPUB文件
async function processEpubFile(file) {
    try {
        updateStatus(`正在处理EPUB文件: ${file.name}`);
        
        // 在浏览器环境中，我们使用JSZip库来解压EPUB文件
        const zip = new JSZip();
        const content = await zip.loadAsync(file);
        
        // 提取EPUB内容
        const bookContent = await extractEpubContent(zip, file.name);
        
        // 添加到书籍列表
        appState.books.push(bookContent);
        
        // 记录处理完成的书籍信息
        console.log(`已处理EPUB文件: ${file.name}, 包含 ${bookContent.contents.length} 个章节`);
    } catch (error) {
        console.error(`处理EPUB文件 ${file.name} 时出错:`, error);
    }
}

// 处理PDF文件
async function processPdfFile(file) {
    try {
        updateStatus(`正在处理PDF文件: ${file.name}`);
        
        // 对于PDF文件，我们保存文件引用
        appState.books.push({
            id: Date.now().toString() + Math.random().toString(36).substring(2, 9),
            title: file.name.replace('.pdf', ''),
            type: 'pdf',
            file: file,
            currentPage: Math.floor(Math.random() * 10) + 1, // 随机初始页码
            totalPages: 0, // 将在加载时更新
            content: null
        });
    } catch (error) {
        console.error(`处理PDF文件 ${file.name} 时出错:`, error);
    }
}

// 处理已解压的EPUB文件夹
async function processUnzippedEpub(folderPath, files) {
    try {
        // 获取文件夹名称作为书籍标题
        const title = folderPath.split('/').pop() || '未命名书籍';
        updateStatus(`正在处理解压的EPUB文件夹: ${title}`);
        
        // 查找OPF文件（EPUB的元数据文件）
        const opfFile = files.find(file => file.name.endsWith('.opf'));
        let spineItems = [];
        
        if (opfFile) {
            // 读取和解析OPF文件以获取spine信息
            const opfContent = await readFileAsText(opfFile);
            spineItems = parseOpfSpine(opfContent, folderPath);
        }
        
        // 如果没有找到OPF文件或无法解析，尝试直接查找HTML文件
        if (!spineItems.length) {
            const htmlFiles = files
                .filter(file => file.name.endsWith('.html') || file.name.endsWith('.htm'))
                .map(file => file.webkitRelativePath);
            
            spineItems = htmlFiles.map(path => ({
                path: path,
                id: path
            }));
        }
        
        // 读取HTML内容
        const contents = [];
        for (const item of spineItems) {
            const file = files.find(f => f.webkitRelativePath === item.path);
            if (file) {
                const content = await readFileAsText(file);
                contents.push({
                    path: item.path,
                    content: content
                });
            }
        }
        
        // 添加到书籍列表
        appState.books.push({
            id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
            title: title,
            type: 'epub',
            contents: contents,
            currentSectionIndex: Math.floor(Math.random() * contents.length), // 随机初始章节
            folderPath: folderPath
        });
    } catch (error) {
        console.error(`处理解压的EPUB文件夹 ${folderPath} 时出错:`, error);
    }
}

// 从ZIP中提取EPUB内容
async function extractEpubContent(zip, title) {
    const contents = [];
    let spineItems = [];
    const imageMap = new Map(); // 存储图片路径到Data URL的映射
    
    // 查找并解析OPF文件
    const fileNames = Object.keys(zip.files);
    const opfFile = fileNames.find(name => name.endsWith('.opf'));
    
    if (opfFile) {
        const opfContent = await zip.file(opfFile).async('text');
        const opfDir = opfFile.substring(0, opfFile.lastIndexOf('/') + 1);
        spineItems = parseOpfSpine(opfContent, opfDir);
    }
    
    // 如果没有找到OPF文件或无法解析，尝试直接查找HTML文件
    if (!spineItems.length) {
        const htmlFiles = fileNames.filter(name => 
            name.endsWith('.html') || name.endsWith('.htm')
        );
        
        spineItems = htmlFiles.map(path => ({
            path: path,
            id: path
        }));
    }
    
    // 提取所有图片资源并转换为Data URL
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.svg', '.bmp', '.webp'];
    for (const fileName of fileNames) {
        const lowerFileName = fileName.toLowerCase();
        if (imageExtensions.some(ext => lowerFileName.endsWith(ext))) {
            try {
                const file = zip.file(fileName);
                if (file && !file.dir) {
                    const content = await file.async('base64');
                    const mimeType = getImageMimeType(fileName);
                    const dataUrl = `data:${mimeType};base64,${content}`;
                    imageMap.set(fileName, dataUrl);
                    // 添加小写版本的路径，用于更灵活的匹配
                    imageMap.set(fileName.toLowerCase(), dataUrl);
                }
            } catch (error) {
                console.error(`处理图片 ${fileName} 时出错:`, error);
            }
        }
    }
    
    // 读取HTML内容
    for (const item of spineItems) {
        if (zip.files[item.path]) {
            const content = await zip.file(item.path).async('text');
            contents.push({
                path: item.path,
                content: content
            });
        }
    }
    
    return {
        id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
        title: title.replace('.epub', ''),
        type: 'epub',
        contents: contents,
        imageMap: imageMap, // 保存图片映射关系
        currentSectionIndex: Math.floor(Math.random() * contents.length) // 随机初始章节
    };
}

// 获取图片的MIME类型
function getImageMimeType(fileName) {
    const lowerFileName = fileName.toLowerCase();
    if (lowerFileName.endsWith('.jpg') || lowerFileName.endsWith('.jpeg')) {
        return 'image/jpeg';
    } else if (lowerFileName.endsWith('.png')) {
        return 'image/png';
    } else if (lowerFileName.endsWith('.gif')) {
        return 'image/gif';
    } else if (lowerFileName.endsWith('.svg')) {
        return 'image/svg+xml';
    } else if (lowerFileName.endsWith('.bmp')) {
        return 'image/bmp';
    } else if (lowerFileName.endsWith('.webp')) {
        return 'image/webp';
    }
    return 'image/jpeg'; // 默认MIME类型
}

// 解析OPF文件中的spine
function parseOpfSpine(opfContent, baseDir) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(opfContent, 'text/xml');
    const spineItems = [];
    
    // 查找spine中的itemref元素
    const itemRefs = xmlDoc.getElementsByTagName('itemref');
    if (itemRefs.length === 0) return spineItems;
    
    // 获取manifest以查找item的href
    const manifest = xmlDoc.getElementsByTagName('manifest')[0];
    if (!manifest) return spineItems;
    
    const manifestItems = {};
    const items = manifest.getElementsByTagName('item');
    for (let i = 0; i < items.length; i++) {
        const id = items[i].getAttribute('id');
        const href = items[i].getAttribute('href');
        if (id && href) {
            manifestItems[id] = href;
        }
    }
    
    // 构建spine项目列表
    for (let i = 0; i < itemRefs.length; i++) {
        const idref = itemRefs[i].getAttribute('idref');
        if (idref && manifestItems[idref]) {
            const href = manifestItems[idref];
            // 确保路径正确
            const path = href.startsWith('/') ? href.substring(1) : baseDir + href;
            spineItems.push({
                id: idref,
                path: path
            });
        }
    }
    
    return spineItems;
}

// 读取文件为文本
function readFileAsText(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = reject;
        reader.readAsText(file);
    });
}

// 显示随机书籍
function displayRandomBook() {
    if (appState.books.length === 0) {
        booksContainer.innerHTML = '<div class="empty-state"><p>未找到可识别的电子书</p><p class="hint">支持EPUB、PDF格式及已解压的EPUB文件夹</p></div>';
        return;
    }
    
    // 随机选择一本书
    const randomIndex = Math.floor(Math.random() * appState.books.length);
    const randomBook = appState.books[randomIndex];
    
    // 随机选择一个章节或页码
    if (randomBook.type === 'epub' && randomBook.contents && randomBook.contents.length > 0) {
        randomBook.currentSectionIndex = Math.floor(Math.random() * randomBook.contents.length);
    } else if (randomBook.type === 'pdf') {
        randomBook.currentPage = Math.floor(Math.random() * 200) + 1;
    }
    
    // 保存当前显示的书籍ID
    appState.displayedBookId = randomBook.id;
    
    // 清空容器并只显示随机选择的书籍
    booksContainer.innerHTML = '';
    
    const bookElement = createBookElement(randomBook);
    booksContainer.appendChild(bookElement);
    
    // 渲染初始内容
    renderBookContent(randomBook);
    
    // 添加加载完成动画
    setTimeout(() => {
        bookElement.classList.add('loaded');
    }, 10);
    
    // 显示通知
    updateStatus('已随机选择书籍和章节');
}

// 创建书籍元素
function createBookElement(book) {
    const templateClone = bookTemplate.content.cloneNode(true);
    const bookItem = templateClone.querySelector('.book-item');
    const chapterNavigation = templateClone.querySelector('.chapter-navigation');
    
    // 设置书籍ID
    bookItem.dataset.bookId = book.id;
    
    // 更新章节信息
    const chapterInfo = templateClone.querySelector('.chapter-info');
    if (chapterInfo && book.type === 'epub') {
        chapterInfo.textContent = `第 ${book.currentSectionIndex + 1} 章 / 共 ${book.contents.length} 章`;
    }
    
    // 为书籍页面容器添加引用
    book.pagesElement = templateClone.querySelector('.book-pages');
    
    // 添加章节导航事件
    const prevBtn = templateClone.querySelector('.prev-chapter');
    const nextBtn = templateClone.querySelector('.next-chapter');
    
    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            if (book.type === 'epub' && book.currentSectionIndex > 0) {
                book.currentSectionIndex--;
                renderBookContent(book);
                updateChapterInfo(bookItem, book);
                updateChapterDropdown(bookItem, book);
            }
        });
    }
    
    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            if (book.type === 'epub' && book.currentSectionIndex < book.contents.length - 1) {
                book.currentSectionIndex++;
                renderBookContent(book);
                updateChapterInfo(bookItem, book);
                updateChapterDropdown(bookItem, book);
            }
        });
    }
    
    // 添加章节选择器事件
    if (chapterInfo && book.type === 'epub') {
        chapterInfo.addEventListener('click', () => {
            toggleChapterDropdown(bookItem, book);
        });
    }
    
    // 生成章节下拉菜单
    generateChapterDropdown(bookItem, book);
    
    return bookItem;
}

// 更新章节信息
function updateChapterInfo(bookElement, book) {
    const chapterInfo = bookElement.querySelector('.chapter-info');
    if (chapterInfo && book.type === 'epub') {
        chapterInfo.textContent = `第 ${book.currentSectionIndex + 1} 章 / 共 ${book.contents.length} 章`;
    }
}

// 生成章节下拉菜单
function generateChapterDropdown(bookElement, book) {
    if (book.type !== 'epub' || !book.contents || book.contents.length === 0) return;
    
    const dropdown = bookElement.querySelector('.chapter-dropdown');
    if (!dropdown) return;
    
    // 清空下拉菜单
    dropdown.innerHTML = '';
    
    // 添加所有章节
    book.contents.forEach((content, index) => {
        const chapterItem = document.createElement('div');
        chapterItem.className = 'chapter-dropdown-item';
        chapterItem.dataset.chapterIndex = index;
        chapterItem.textContent = `第 ${index + 1} 章`;
        
        // 如果是当前章节，添加active类
        if (index === book.currentSectionIndex) {
            chapterItem.classList.add('active');
        }
        
        // 添加点击事件
        chapterItem.addEventListener('click', () => {
            selectChapter(bookElement, book, index);
        });
        
        dropdown.appendChild(chapterItem);
    });
}

// 切换章节下拉菜单显示状态
function toggleChapterDropdown(bookElement, book) {
    if (book.type !== 'epub') return;
    
    const dropdown = bookElement.querySelector('.chapter-dropdown');
    if (!dropdown) return;
    
    // 隐藏所有其他下拉菜单
    document.querySelectorAll('.chapter-dropdown').forEach(d => {
        if (d !== dropdown) {
            d.style.display = 'none';
        }
    });
    
    // 切换当前下拉菜单的显示状态
    dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block';
}

// 点击外部区域关闭下拉框
document.addEventListener('click', function(event) {
    const dropdowns = document.querySelectorAll('.chapter-dropdown');
    const chapterInfos = document.querySelectorAll('.chapter-info');
    
    // 检查点击是否在下拉框或章节信息元素上
    const isClickOnDropdown = Array.from(dropdowns).some(dropdown => dropdown.contains(event.target));
    const isClickOnChapterInfo = Array.from(chapterInfos).some(info => info.contains(event.target));
    
    // 如果点击不在下拉框或章节信息元素上，隐藏所有下拉框
    if (!isClickOnDropdown && !isClickOnChapterInfo) {
        dropdowns.forEach(dropdown => {
            dropdown.style.display = 'none';
        });
    }
});


// 更新章节下拉菜单中当前章节的高亮状态
function updateChapterDropdown(bookElement, book) {
    if (book.type !== 'epub') return;
    
    const dropdown = bookElement.querySelector('.chapter-dropdown');
    if (!dropdown) return;
    
    // 更新所有章节项的active状态
    dropdown.querySelectorAll('.chapter-dropdown-item').forEach(item => {
        const chapterIndex = parseInt(item.dataset.chapterIndex);
        if (chapterIndex === book.currentSectionIndex) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });
}

// 选择章节
function selectChapter(bookElement, book, chapterIndex) {
    if (book.type !== 'epub' || chapterIndex < 0 || chapterIndex >= book.contents.length) return;
    
    // 更新当前章节索引
    book.currentSectionIndex = chapterIndex;
    
    // 重新渲染书籍内容
    renderBookContent(book);
    
    // 更新章节信息
    updateChapterInfo(bookElement, book);
    
    // 更新章节下拉菜单
    updateChapterDropdown(bookElement, book);
    
    // 隐藏下拉菜单
    const dropdown = bookElement.querySelector('.chapter-dropdown');
    if (dropdown) {
        dropdown.style.display = 'none';
    }
}

// 渲染书籍内容
function renderBookContent(book) {
    if (!book.pagesElement) return;
    
    // 显示加载状态
    book.pagesElement.innerHTML = '<div class="loading">正在加载内容</div>';
    
    if (book.type === 'epub') {
        renderEpubContent(book);
    } else if (book.type === 'pdf') {
        renderPdfContent(book);
    }
    
    // 滚动到页面顶部
    book.pagesElement.scrollTop = 0;
}

// 渲染EPUB内容
function renderEpubContent(book) {
    if (!book.contents || book.contents.length === 0) {
        book.pagesElement.innerHTML = '<div class="empty-state"><p>无法加载内容</p></div>';
        return;
    }
    
    // 确保currentSectionIndex有效
    if (book.currentSectionIndex >= book.contents.length) {
        book.currentSectionIndex = 0;
    } else if (book.currentSectionIndex < 0) {
        book.currentSectionIndex = 0;
    }
    
    const currentSection = book.contents[book.currentSectionIndex];
    const htmlContent = currentSection.content;
    const htmlPath = currentSection.path;
    
    // 处理HTML内容，传递imageMap和当前HTML路径
    const processedContent = processHtmlContent(htmlContent, book.imageMap, htmlPath);
    
    // 更新页面内容
    book.pagesElement.innerHTML = processedContent;
    
    // 增强内容中的图片显示
    enhanceImages(book.pagesElement);
    
    // 滚动到页面顶部
    book.pagesElement.scrollTop = 0;
}

// 渲染PDF内容
function renderPdfContent(book) {
    // 使用pdf.js库渲染PDF内容（滚动翻页方式）
    book.pagesElement.innerHTML = `
        <div class="pdf-viewer">
            <div class="pdf-container-scroll" style="overflow-y: auto; max-height: calc(100vh - 150px);">
                <div id="pdf-pages-container-${book.id}" class="pdf-pages-container">
                    <!-- 所有PDF页面将在这里动态添加 -->
                </div>
                <div class="pdf-loading" style="display: flex; justify-content: center; align-items: center; min-height: 300px;">
                    <div class="loading-spinner"></div>
                    <span>正在加载PDF页面...</span>
                </div>
            </div>
        </div>
    `;
    
    // 获取容器元素
    const pagesContainer = document.getElementById(`pdf-pages-container-${book.id}`);
    const loading = book.pagesElement.querySelector('.pdf-loading');
    
    // 配置pdf.js的工作路径
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.0.279/pdf.worker.min.js';
    
    // 加载并渲染PDF页面（滚动模式）
    async function loadAndRenderPdfScroll() {
        try {
            if (!book.file) {
                console.error('PDF文件对象不存在');
                return;
            }
            
            // 读取文件并加载PDF
            const fileReader = new FileReader();
            fileReader.onload = async function() {
                try {
                    // 将文件数据转换为PDF文档
                    const typedArray = new Uint8Array(this.result);
                    const pdf = await pdfjsLib.getDocument(typedArray).promise;
                    
                    // 更新总页数
                    book.totalPages = pdf.numPages;
                    
                    // 隐藏加载提示
                    if (loading) {
                        loading.style.display = 'none';
                    }
                    
                    // 确保currentPage在有效范围内
                    if (book.currentPage <= 0 || book.currentPage > pdf.numPages) {
                        book.currentPage = 1; // 如果无效，重置为第一页
                    }
                    
                    // 从currentPage开始渲染，而不是总是从第1页开始
                    const startPage = book.currentPage;
                    const endPage = Math.min(startPage + 4, pdf.numPages); // 渲染当前页及之后的4页
                    await renderPagesInRange(startPage, endPage, pdf);
                    
                    // 设置滚动加载监听
                    setupScrollLoading(pdf);
                    
                } catch (error) {
                    console.error('渲染PDF页面时出错:', error);
                    if (loading) {
                        loading.innerHTML = '<p>渲染PDF页面时出错</p>';
                    }
                }
            };
            
            fileReader.onerror = function() {
                console.error('读取PDF文件时出错');
                if (loading) {
                    loading.innerHTML = '<p>读取PDF文件时出错</p>';
                }
            };
            
            // 开始读取文件
            fileReader.readAsArrayBuffer(book.file);
            
        } catch (error) {
            console.error('加载PDF时出错:', error);
            if (loading) {
                loading.innerHTML = '<p>加载PDF时出错</p>';
            }
        }
    }
    
    // 渲染指定范围内的PDF页面
    async function renderPagesInRange(startPage, endPage, pdf) {
        for (let pageNum = startPage; pageNum <= endPage; pageNum++) {
            try {
                // 创建页面容器
                const pageDiv = document.createElement('div');
                pageDiv.className = 'pdf-page';
                pageDiv.dataset.pageNum = pageNum;
                
                // 创建canvas元素
                const canvas = document.createElement('canvas');
                canvas.className = 'pdf-canvas';
                pageDiv.appendChild(canvas);
                
                // 添加到页面容器
                pagesContainer.appendChild(pageDiv);
                
                // 获取页面并渲染
                const page = await pdf.getPage(pageNum);
                const viewport = page.getViewport({ scale: 1.2 }); // 适当的缩放
                
                // 设置canvas尺寸
                canvas.width = viewport.width;
                canvas.height = viewport.height;
                
                // 渲染到canvas
                await page.render({
                    canvasContext: canvas.getContext('2d'),
                    viewport: viewport
                }).promise;
                
            } catch (error) {
                console.error(`渲染第${pageNum}页时出错:`, error);
            }
        }
    }
    
    // 设置滚动加载更多页面
    function setupScrollLoading(pdf) {
        const container = book.pagesElement.querySelector('.pdf-container-scroll');
        let isLoading = false;
        let loadedPages = 5; // 初始已加载页数
        
        container.addEventListener('scroll', async () => {
            // 当滚动到底部附近时加载更多页面
            if (container.scrollTop + container.clientHeight >= container.scrollHeight - 200 && 
                !isLoading && loadedPages < pdf.numPages) {
                
                isLoading = true;
                
                // 显示加载提示
                if (loading) {
                    loading.style.display = 'flex';
                }
                
                // 加载下一批页面
                const nextPage = loadedPages + 1;
                const endPage = Math.min(loadedPages + 5, pdf.numPages);
                await renderPagesInRange(nextPage, endPage, pdf);
                
                loadedPages = endPage;
                isLoading = false;
                
                // 隐藏加载提示
                if (loading && loadedPages >= pdf.numPages) {
                    loading.style.display = 'none';
                }
            }
        });
    }
    
    // 启动PDF加载和渲染
    loadAndRenderPdfScroll();
}

// 处理HTML内容
function processHtmlContent(htmlContent, imageMap = new Map(), htmlPath = '') {
    // 移除所有CSS链接引用，避免404错误
    htmlContent = htmlContent.replace(/<link[^>]*rel=["']stylesheet["'][^>]*>/gi, '');
    
    // 使用DOMParser解析HTML
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlContent, 'text/html');
    
    // 提取body内容
    let bodyContent = doc.body ? doc.body.innerHTML : htmlContent;
    
    // 清理不必要的脚本和样式
    bodyContent = bodyContent
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .trim();
    
    // 修正图片路径，添加适当的类，并替换为Data URL
    bodyContent = bodyContent.replace(/<img\s+([^>]*)src=["']([^"']*)["']([^>]*)>/gi, function(match, attrBefore, src, attrAfter) {
        // 尝试将相对路径转换为绝对路径，并查找对应的Data URL
        let dataUrl = src;
        
        // 如果src是相对路径，尝试在imageMap中查找
        if (imageMap.size > 0 && !src.startsWith('http://') && !src.startsWith('https://') && !src.startsWith('data:')) {
            // 计算HTML文件所在的目录
            const htmlDir = htmlPath ? htmlPath.substring(0, htmlPath.lastIndexOf('/') + 1) : '';
            
            // 计算图片的绝对路径
            let absolutePath;
            if (src.startsWith('/')) {
                // 根路径，直接使用
                absolutePath = src.substring(1); // 移除开头的斜杠
            } else {
                // 相对路径，结合HTML文件所在目录
                absolutePath = htmlDir + src;
                // 简化路径，处理../和./
                absolutePath = simplifyPath(absolutePath);
            }
            
            // 尝试匹配原始路径和小写路径
            let found = false;
            if (imageMap.has(absolutePath)) {
                dataUrl = imageMap.get(absolutePath);
                found = true;
            } else if (imageMap.has(absolutePath.toLowerCase())) {
                dataUrl = imageMap.get(absolutePath.toLowerCase());
                found = true;
            } 
            
            // 如果没找到，尝试匹配不同路径格式
            if (!found) {
                const possiblePaths = [
                    absolutePath,
                    absolutePath.toLowerCase(),
                    src,
                    src.toLowerCase(),
                    './' + src,
                    './' + src.toLowerCase(),
                    '../' + src,
                    '../' + src.toLowerCase()
                ];
                
                for (const path of possiblePaths) {
                    if (imageMap.has(path)) {
                        dataUrl = imageMap.get(path);
                        break;
                    }
                }
            }
        }
        
        // 保留原有的类，如果没有则添加book-image类
        const hasClass = /\bclass=["'][^"']*["']/.test(attrBefore + attrAfter);
        if (hasClass) {
            // 已有class属性，添加book-image类
            return match.replace(/class=["']([^"']*)["']/, 'class="$1 book-image"').replace(src, dataUrl);
        } else {
            // 没有class属性，添加一个
            return '<img ' + attrBefore + ' src="' + dataUrl + '" ' + attrAfter + ' class="book-image" loading="lazy" alt="电子书图片">';
        }
    });
    
    // 添加简化路径的辅助函数
    function simplifyPath(path) {
        const parts = path.split('/');
        const result = [];
        
        for (const part of parts) {
            if (part === '.' || part === '') {
                continue;
            } else if (part === '..') {
                result.pop();
            } else {
                result.push(part);
            }
        }
        
        return result.join('/');
    }
    
    // 处理链接 - 区分外部链接、内部文件链接和页内锚点链接
    bodyContent = bodyContent.replace(/<a\s+([^>]*)href=["']([^"']*)["']([^>]*)>/gi, function(match, attrBefore, href, attrAfter) {
        // 检查是否为外部链接（以http://或https://开头）
        if (href.startsWith('http://') || href.startsWith('https://')) {
            // 外部链接在新标签页打开
            return '<a ' + attrBefore + ' href="' + href + '" ' + attrAfter + ' target="_blank" rel="noopener noreferrer">';
        } 
        // 检查是否为纯锚点链接（只包含#符号）
        else if (href.startsWith('#')) {
            // 纯锚点链接，保持原样，用于页内导航
            return '<a ' + attrBefore + ' href="' + href + '" ' + attrAfter + '>';
        }
        // 检查是否为包含锚点的内部链接
        else if (href.includes('#')) {
            // 对于包含锚点的内部链接，只保留锚点部分
            // 因为我们的EPUB内容是动态渲染的，不是作为独立文件加载的
            const anchor = href.split('#')[1];
            return '<a ' + attrBefore + ' href="#' + anchor + '" ' + attrAfter + '>';
        }
        else {
            // 其他内部链接，阻止默认行为，避免404错误
            return '<a ' + attrBefore + ' href="' + href + '" ' + attrAfter + ' onclick="event.preventDefault(); return false;">';
        }
    });
    
    // 创建临时元素来处理HTML，确保保留原始的缩进和段落间距
    const tempElement = document.createElement('div');
    tempElement.innerHTML = bodyContent;
    
    // 保留原始的缩进和段落间距
    const paragraphs = tempElement.querySelectorAll('p');
    paragraphs.forEach(para => {
        // 确保段落有适当的间距
        para.style.marginBottom = '15px';
        para.style.textIndent = '2em';
        para.style.textAlign = 'justify';
    });
    
    // 处理标题
    const headings = tempElement.querySelectorAll('h1, h2, h3, h4, h5, h6');
    headings.forEach(heading => {
        heading.style.margin = '25px 0 15px 0';
        heading.style.color = '#2c3e50';
        heading.style.fontWeight = 'bold';
    });
    
    // 处理列表
    const lists = tempElement.querySelectorAll('ul, ol');
    lists.forEach(list => {
        list.style.marginBottom = '15px';
        list.style.paddingLeft = '2em';
    });
    
    const listItems = tempElement.querySelectorAll('li');
    listItems.forEach(item => {
        item.style.marginBottom = '5px';
    });
    
    return tempElement.innerHTML;
}

// 调整字体大小
function adjustFontSize(book, direction) {
    if (!book || !book.pagesElement) return;
    
    const pagesElement = book.pagesElement;
    const currentSize = parseInt(getComputedStyle(pagesElement).fontSize);
    
    // 定义字体大小范围和步长
    const sizes = [14, 15, 16, 18, 20];
    
    // 找到当前字体大小在数组中的索引
    let currentIndex = sizes.indexOf(currentSize);
    if (currentIndex === -1) {
        // 如果当前大小不在预设数组中，找到最接近的
        currentIndex = sizes.reduce((closest, size, index) => 
            Math.abs(size - currentSize) < Math.abs(sizes[closest] - currentSize) ? index : closest, 0);
    }
    
    // 计算新的索引
    const newIndex = Math.max(0, Math.min(sizes.length - 1, currentIndex + direction));
    
    // 设置新的字体大小
    const newSize = sizes[newIndex];
    pagesElement.style.fontSize = `${newSize}px`;
    
    // 更新状态
    updateStatus(`字体大小已调整为 ${newSize}px`);
}

// 随机化当前书籍的章节
function randomizeCurrentBookChapter() {
    if (!appState.inRandomDisplayMode || !appState.displayedBookId) {
        return;
    }
    
    // 找到当前显示的书籍
    const currentBook = appState.books.find(book => book.id === appState.displayedBookId);
    if (!currentBook) {
        return;
    }
    
    // 随机选择一个章节或页码
    if (currentBook.type === 'epub' && currentBook.contents && currentBook.contents.length > 0) {
        currentBook.currentSectionIndex = Math.floor(Math.random() * currentBook.contents.length);
        renderBookContent(currentBook);
        
        // 更新章节信息
        const bookElement = document.querySelector(`[data-book-id="${currentBook.id}"]`);
        if (bookElement) {
            updateChapterInfo(bookElement, currentBook);
        }
        
        // 显示通知
        updateStatus('已随机选择当前书籍的章节');
    } else if (currentBook.type === 'pdf' && currentBook.totalPages > 0) {
        currentBook.currentPage = Math.floor(Math.random() * currentBook.totalPages) + 1;
        renderBookContent(currentBook);
        
        // 显示通知
        updateStatus('已随机选择当前书籍的页码');
    }
}

// 增强图片显示
function enhanceImages(container) {
    const images = container.querySelectorAll('img'); // 处理所有图片
    images.forEach(img => {
        // 设置最大宽度，确保图片适应容器
        img.style.maxWidth = '100%';
        img.style.height = 'auto';
        img.style.display = 'block';
        img.style.margin = '20px auto';
        img.style.borderRadius = '5px';
        img.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.1)';
        img.style.transition = 'all 0.3s ease';
        
        // 添加点击放大功能
        img.addEventListener('click', (e) => {
            e.stopPropagation(); // 阻止事件冒泡
            if (img.classList.contains('zoomed')) {
                img.classList.remove('zoomed');
                img.style.cursor = 'zoom-in';
            } else {
                img.classList.add('zoomed');
                img.style.cursor = 'zoom-out';
            }
        });
        
        // 默认显示放大图标
        img.style.cursor = 'zoom-in';
        
        // 为图片添加加载失败处理
        img.addEventListener('error', () => {
            // 图片加载失败时，显示占位符
            img.style.backgroundColor = '#f8f9fa';
            img.style.border = '1px dashed #dee2e6';
            img.style.display = 'flex';
            img.style.alignItems = 'center';
            img.style.justifyContent = 'center';
            img.style.minHeight = '100px';
            img.style.color = '#6c757d';
            img.innerHTML = '图片无法加载';
            img.style.fontSize = '12px';
            img.style.fontStyle = 'italic';
        });
    });
}

// 更新状态栏
function updateStatus(message) {
    if (statusText) {
        statusText.textContent = message;
    } else {
        console.warn('Status element not found');
    }
}

// 自动滚动相关功能

// 启动自动滚动
function startAutoScroll(book) {
    if (!book || !book.pagesElement || appState.autoScroll) return;
    
    appState.autoScroll = true;
    
    // 更新按钮样式
    const toggleBtn = document.getElementById('toggleAutoScrollBtn');
    if (toggleBtn) {
        toggleBtn.style.backgroundColor = 'rgba(76, 175, 80, 0.8)';
    }
    
    // 开始滚动
    appState.scrollIntervalId = setInterval(() => {
        if (!appState.autoScroll) return;
        
        // 执行滚动
        book.pagesElement.scrollTop += 1;
        
        // 检测是否触底
        checkScrollEnd(book);
    }, appState.scrollSpeed);
}

// 停止自动滚动
function stopAutoScroll() {
    appState.autoScroll = false;
    
    // 清除滚动间隔
    if (appState.scrollIntervalId) {
        clearInterval(appState.scrollIntervalId);
        appState.scrollIntervalId = null;
    }
    
    // 更新按钮样式
    const toggleBtn = document.getElementById('toggleAutoScrollBtn');
    if (toggleBtn) {
        toggleBtn.style.backgroundColor = 'rgba(255, 255, 255, 0.2)';
    }
}

// 切换自动滚动状态
function toggleAutoScroll() {
    const currentBook = appState.books.find(book => book.id === appState.displayedBookId);
    if (!currentBook) return;
    
    if (appState.autoScroll) {
        stopAutoScroll();
    } else {
        startAutoScroll(currentBook);
    }
}

// 调整滚动速度
function adjustScrollSpeed(direction) {
    // 速度范围：10ms - 200ms
    // 调整逻辑：direction为正表示加快，为负表示减慢
    // 调整幅度从10ms增加到20ms，使变化更明显
    appState.scrollSpeed = Math.max(10, Math.min(200, appState.scrollSpeed - (direction * 20)));
    
    // 更新状态
    updateStatus(`滚动速度已调整为 ${appState.scrollSpeed}ms`);
    
    // 如果当前正在滚动，重启滚动以应用新速度
    if (appState.autoScroll) {
        const currentBook = appState.books.find(book => book.id === appState.displayedBookId);
        if (currentBook) {
            stopAutoScroll();
            startAutoScroll(currentBook);
        }
    }
}

// 检测滚动是否触底
function checkScrollEnd(book) {
    if (!book || !book.pagesElement) return;
    
    const pagesElement = book.pagesElement;
    const scrollHeight = pagesElement.scrollHeight;
    const clientHeight = pagesElement.clientHeight;
    
    // 检查内容是否不足以产生滚动
    const contentTooShort = scrollHeight <= clientHeight;
    const isAtBottom = pagesElement.scrollTop + clientHeight >= scrollHeight - 10;
    
    if (isAtBottom) {
        // 停止当前滚动
        stopAutoScroll();
        
        // 切换到下一章节或下一本书
        handleScrollEnd(book, contentTooShort);
    }
}

// 处理滚动触底
function handleScrollEnd(book, contentTooShort = false) {
    if (book.type === 'epub') {
        // 检查是否是当前书的最后一个章节
        if (book.currentSectionIndex < book.contents.length - 1) {
            // 如果内容太短，停顿5秒后再切换
            if (contentTooShort) {
                setTimeout(() => {
                    // 切换到下一章节
                    book.currentSectionIndex++;
                    renderBookContent(book);
                    
                    // 更新章节信息
                    const bookElement = document.querySelector(`[data-book-id="${book.id}"]`);
                    if (bookElement) {
                        updateChapterInfo(bookElement, book);
                        updateChapterDropdown(bookElement, book);
                    }
                    
                    // 重新启动自动滚动
                    setTimeout(() => startAutoScroll(book), 500);
                }, 5000); // 停顿5秒
            } else {
                // 正常切换
                book.currentSectionIndex++;
                renderBookContent(book);
                
                // 更新章节信息
                const bookElement = document.querySelector(`[data-book-id="${book.id}"]`);
                if (bookElement) {
                    updateChapterInfo(bookElement, book);
                    updateChapterDropdown(bookElement, book);
                }
                
                // 重新启动自动滚动
                setTimeout(() => startAutoScroll(book), 500);
            }
        } else {
            // 如果内容太短，停顿5秒后再切换到下一本书
            if (contentTooShort) {
                setTimeout(() => {
                    switchToNextBook();
                }, 5000); // 停顿5秒
            } else {
                // 当前书已读完，切换到下一本书
                switchToNextBook();
            }
        }
    }
}

// 切换到下一本书
function switchToNextBook() {
    if (appState.books.length === 0) return;
    
    // 初始化阅读顺序列表
    if (appState.readBooksOrder.length === 0) {
        // 随机排序图书
        appState.readBooksOrder = [...appState.books].sort(() => Math.random() - 0.5);
        appState.currentReadIndex = 0;
    } else {
        // 移动到下一本书
        appState.currentReadIndex++;
        
        // 如果所有图书都已阅读，重新随机排序
        if (appState.currentReadIndex >= appState.readBooksOrder.length) {
            appState.readBooksOrder = [...appState.books].sort(() => Math.random() - 0.5);
            appState.currentReadIndex = 0;
        }
    }
    
    // 获取下一本书
    const nextBook = appState.readBooksOrder[appState.currentReadIndex];
    if (!nextBook) return;
    
    // 设置为第一章
    if (nextBook.type === 'epub' && nextBook.contents && nextBook.contents.length > 0) {
        nextBook.currentSectionIndex = 0;
    }
    
    // 保存当前显示的书籍ID
    appState.displayedBookId = nextBook.id;
    
    // 清空容器并显示新书
    booksContainer.innerHTML = '';
    
    const bookElement = createBookElement(nextBook);
    booksContainer.appendChild(bookElement);
    
    // 渲染初始内容
    renderBookContent(nextBook);
    
    // 添加加载完成动画
    setTimeout(() => {
        bookElement.classList.add('loaded');
    }, 10);
    
    // 重新启动自动滚动
    setTimeout(() => startAutoScroll(nextBook), 500);
}

// 设置自动滚动事件监听器
function setupAutoScrollEventListeners() {
    // 全局点击事件委托，处理自动滚动相关按钮
    document.addEventListener('click', function(e) {
        // 处理自动滚动开关按钮
        if (e.target.id === 'toggleAutoScrollBtn') {
            toggleAutoScroll();
        }
        // 处理滚动速度调整按钮
        else if (e.target.classList.contains('speed-btn')) {
            if (e.target.classList.contains('decrease-speed')) {
                adjustScrollSpeed(-1);
            } else if (e.target.classList.contains('increase-speed')) {
                adjustScrollSpeed(1);
            }
        }
    });
}

// 页面加载完成后初始化应用
document.addEventListener('DOMContentLoaded', () => {
    initApp();
    setupAutoScrollEventListeners();
});
