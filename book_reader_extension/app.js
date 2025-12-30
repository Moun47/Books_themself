// 电子书阅读器应用（Chrome扩展版本）

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
    currentReadIndex: 0,
    // 自动滚动限制在当前书循环
    loopCurrentBook: false
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
    setupAutoScrollEventListeners();
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
            selectFolder();
        }
        // 处理文件夹选择按钮点击
        else if (e.target.classList.contains('folder-select-btn-icon') || e.target.id === 'folderSelectBtn') {
            selectFolder();
        }
        // 处理字体大小调整按钮点击
        else if (e.target.classList.contains('font-size-btn')) {
            const bookElement = e.target.closest('.book-item');
            if (bookElement) {
                const bookId = bookElement.dataset.bookId;
                const book = appState.books.find(b => b.id === bookId);
                if (book) {
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

// 选择文件夹
function selectFolder() {
    if (folderInput) {
        folderInput.click();
    }
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
        
        if (appState.books.length > 0) {
            // 显示随机书籍
            await displayRandomBook();
            
            updateStatus(`已加载 ${appState.books.length} 本电子书`);
        } else {
            updateStatus('没有找到有效的电子书文件');
            booksContainer.innerHTML = '<div class="empty-state"><p>没有找到有效的电子书文件</p><p class="hint">请确保文件夹中包含EPUB或PDF格式的电子书</p></div>';
        }
    } catch (error) {
        console.error('处理文件夹时出错:', error);
        updateStatus('处理文件夹时出错');
        booksContainer.innerHTML = '<div class="empty-state"><p>处理文件夹时出错</p><p class="hint">请检查文件夹内容并重试</p></div>';
    } finally {
        appState.loading = false;
        // 清除input值，以便可以重新选择同一文件夹
        if (folderInput) {
            folderInput.value = '';
        }
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
    } catch (error) {
        console.error(`处理EPUB文件 ${file.name} 时出错:`, error);
        updateStatus(`处理EPUB文件 ${file.name} 时出错`);
    }
}

// 处理PDF文件
async function processPdfFile(file) {
    try {
        updateStatus(`正在处理PDF文件: ${file.name}`);
        
        // 读取PDF文件
        const arrayBuffer = await file.arrayBuffer();
        
        // 创建PDF书籍对象
        const book = {
            id: generateId(),
            title: file.name.replace('.pdf', ''),
            fileName: file.name,
            fileType: 'pdf',
            file: file,
            arrayBuffer: arrayBuffer,
            pages: [], // 页数将在渲染时确定
            currentPageIndex: 0,
            totalPages: 0
        };
        
        // 添加到书籍列表
        appState.books.push(book);
    } catch (error) {
        console.error(`处理PDF文件 ${file.name} 时出错:`, error);
        updateStatus(`处理PDF文件 ${file.name} 时出错`);
    }
}

// 处理已解压的EPUB文件夹
async function processUnzippedEpub(folderPath, files) {
    try {
        updateStatus(`正在处理已解压的EPUB文件夹: ${folderPath}`);
        
        // 找出content.opf文件
        const opfFile = files.find(file => file.name === 'content.opf' || 
                                          file.name.endsWith('/content.opf'));
        
        if (!opfFile) {
            console.warn(`在文件夹 ${folderPath} 中未找到content.opf文件，跳过此文件夹`);
            return;
        }
        
        // 读取content.opf文件内容
        const opfContent = await readFileAsText(opfFile);
        
        // 解析OPF文件，提取书籍信息
        const book = {
            id: generateId(),
            title: folderPath.split('/').pop() || '未知书名',
            fileName: folderPath.split('/').pop() || 'unknown',
            fileType: 'epub-unzipped',
            folderPath: folderPath,
            files: files,
            chapters: [],
            currentChapterIndex: 0,
            totalChapters: 0
        };
        
        // 解析OPF文件中的spine，获取章节列表
        const chapters = parseOpfSpine(opfContent, folderPath);
        book.chapters = chapters;
        book.totalChapters = chapters.length;
        
        // 添加到书籍列表
        appState.books.push(book);
    } catch (error) {
        console.error(`处理已解压的EPUB文件夹 ${folderPath} 时出错:`, error);
        updateStatus(`处理已解压的EPUB文件夹 ${folderPath} 时出错`);
    }
}

// 从ZIP中提取EPUB内容
async function extractEpubContent(zip, title) {
    try {
        // 创建书籍对象
        const book = {
            id: generateId(),
            title: title.replace('.epub', ''),
            fileName: title,
            fileType: 'epub',
            chapters: [],
            currentChapterIndex: 0,
            totalChapters: 0,
            zip: zip // 保存ZIP对象，以便后续访问
        };
        
        // 查找content.opf文件
        let opfPath = null;
        for (const path in zip.files) {
            if (path.toLowerCase().includes('content.opf')) {
                opfPath = path;
                break;
            }
        }
        
        if (!opfPath) {
            // 尝试查找其他可能的OPF文件
            for (const path in zip.files) {
                if (path.endsWith('.opf')) {
                    opfPath = path;
                    break;
                }
            }
        }
        
        if (!opfPath) {
            throw new Error('未找到OPF文件');
        }
        
        // 读取OPF文件内容
        const opfContent = await zip.file(opfPath).async('text');
        
        // 解析OPF文件中的spine，获取章节列表
        const baseDir = opfPath.substring(0, opfPath.lastIndexOf('/'));
        const chapters = parseOpfSpine(opfContent, baseDir);
        
        book.chapters = chapters;
        book.totalChapters = chapters.length;
        
        return book;
    } catch (error) {
        console.error(`提取EPUB内容时出错:`, error);
        throw error;
    }
}

// 解析OPF文件中的spine，获取章节列表
function parseOpfSpine(opfContent, baseDir) {
    try {
        // 使用DOMParser解析XML
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(opfContent, 'application/xml');
        
        // 获取spine元素
        const spineElement = xmlDoc.querySelector('spine');
        if (!spineElement) {
            throw new Error('未找到spine元素');
        }
        
        // 获取所有itemref元素
        const itemrefs = spineElement.querySelectorAll('itemref');
        if (!itemrefs.length) {
            throw new Error('未找到itemref元素');
        }
        
        // 获取manifest元素，用于查找item的href
        const manifestElement = xmlDoc.querySelector('manifest');
        if (!manifestElement) {
            throw new Error('未找到manifest元素');
        }
        
        // 创建章节列表
        const chapters = [];
        
        // 遍历itemref元素，创建章节对象
        for (let i = 0; i < itemrefs.length; i++) {
            const itemref = itemrefs[i];
            const idref = itemref.getAttribute('idref');
            
            // 在manifest中查找对应的item
            const itemElement = manifestElement.querySelector(`item[id="${idref}"]`);
            if (!itemElement) {
                console.warn(`未找到id为 ${idref} 的item元素，跳过此章节`);
                continue;
            }
            
            // 获取章节的href
            const href = itemElement.getAttribute('href');
            if (!href) {
                console.warn(`item元素 ${idref} 没有href属性，跳过此章节`);
                continue;
            }
            
            // 构建完整的章节路径
            const chapterPath = baseDir ? `${baseDir}/${href}` : href;
            
            // 创建章节对象
            const chapter = {
                id: idref,
                index: i,
                title: `第 ${i + 1} 章`,
                path: chapterPath
            };
            
            // 添加到章节列表
            chapters.push(chapter);
        }
        
        return chapters;
    } catch (error) {
        console.error(`解析OPF spine时出错:`, error);
        return [];
    }
}

// 读取文件为文本
function readFileAsText(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsText(file);
    });
}

// 读取文件为ArrayBuffer
function readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
    });
}

// 生成唯一ID
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// 创建书籍元素
function createBookElement(book) {
    try {
        // 检查书籍模板是否存在
        if (!bookTemplate) {
            console.error('书籍模板未找到');
            return null;
        }
        
        // 克隆书籍模板
        const bookElement = bookTemplate.content.cloneNode(true).querySelector('.book-item');
        
        // 设置书籍ID
        bookElement.dataset.bookId = book.id;
        
        // 更新章节信息
        const chapterInfo = bookElement.querySelector('.chapter-info');
        if (chapterInfo) {
            if (book.fileType === 'pdf') {
                chapterInfo.textContent = `第 ${book.currentPageIndex + 1} 页 / 共 ${book.totalPages || '?'}`;
            } else {
                chapterInfo.textContent = `第 ${book.currentChapterIndex + 1} 章 / 共 ${book.totalChapters} 章`;
            }
        }
        
        // 添加导航按钮事件监听
        const prevButton = bookElement.querySelector('.prev-chapter');
        const nextButton = bookElement.querySelector('.next-chapter');
        
        if (prevButton) {
            prevButton.addEventListener('click', () => {
                navigateBook(book, -1);
            });
        }
        
        if (nextButton) {
            nextButton.addEventListener('click', () => {
                navigateBook(book, 1);
            });
        }
        
        // 添加章节选择器事件（仅EPUB）
        if ((book.fileType === 'epub' || book.fileType === 'epub-unzipped') && chapterInfo) {
            chapterInfo.addEventListener('click', () => {
                toggleChapterDropdown(bookElement, book);
            });
        }
        
        // 生成章节下拉菜单（仅EPUB）
        generateChapterDropdown(bookElement, book);
        
        return bookElement;
    } catch (error) {
        console.error('创建书籍元素时出错:', error);
        return null;
    }
}

// 显示随机书籍
async function displayRandomBook() {
    // 检查书籍模板是否存在
    if (!bookTemplate) {
        console.error('书籍模板未找到');
        updateStatus('应用初始化失败：未找到书籍模板');
        return;
    }
    
    if (!appState.books.length) {
        updateStatus('没有找到电子书，请重新选择文件夹');
        return;
    }
    
    try {
        // 随机选择一本书
        const randomIndex = Math.floor(Math.random() * appState.books.length);
        const randomBook = appState.books[randomIndex];
        
        // 随机选择一个章节或页面
        if (randomBook.fileType === 'pdf') {
            // 随机选择PDF页面
            if (randomBook.totalPages > 0) {
                randomBook.currentPageIndex = Math.floor(Math.random() * randomBook.totalPages);
            }
        } else {
            // 随机选择EPUB章节
            if (randomBook.chapters && randomBook.chapters.length > 0) {
                randomBook.currentChapterIndex = Math.floor(Math.random() * randomBook.chapters.length);
            }
        }
        
        // 显示选中的书籍
        await displayBook(randomBook);
    } catch (error) {
        console.error('显示随机书籍时出错:', error);
        updateStatus('显示随机书籍时出错');
    }
}

// 显示指定书籍
async function displayBook(book) {
    if (!book) {
        console.error('No book provided');
        return;
    }
    
    try {
        // 更新应用状态
        appState.currentBook = book;
        appState.displayedBookId = book.id;
        appState.inRandomDisplayMode = false;
        
        // 清空书籍容器
        booksContainer.innerHTML = '';
        
        // 创建并添加书籍元素
        const bookElement = createBookElement(book);
        if (bookElement) {
            booksContainer.appendChild(bookElement);
            
            // 添加loaded类，确保书籍内容可见
            setTimeout(() => {
                bookElement.classList.add('loaded');
            }, 100);
            
            // 渲染书籍内容
            await renderBookContent(book);
            
            // 更新状态
            updateStatus(`正在阅读: ${book.title}`);
        }
    } catch (error) {
        console.error('显示书籍时出错:', error);
        updateStatus('显示书籍时出错');
    }
}

// 渲染书籍内容
async function renderBookContent(book) {
    if (!book) {
        console.error('No book provided');
        return;
    }
    
    try {
        // 根据书籍类型选择不同的渲染函数
        if (book.fileType === 'pdf') {
            renderPdfContent(book);
        } else {
            await renderEpubContent(book);
        }
        
        // 更新章节信息
        updateChapterInfo(book);
        
        // 更新章节下拉菜单（仅EPUB，且只有在找到书籍元素时才更新）
        if (book.fileType !== 'pdf') {
            const bookElement = document.querySelector(`[data-book-id="${book.id}"]`);
            if (bookElement) {
                updateChapterDropdown(bookElement, book);
            }
        }
        
        // 滚动到页面顶部
        const contentContainer = document.querySelector(`[data-book-id="${book.id}"] .book-pages`);
        if (contentContainer) {
            contentContainer.scrollTop = 0;
        }
        
    } catch (error) {
        console.error('渲染书籍内容时出错:', error);
        updateStatus('渲染书籍内容时出错');
    }
}

// 渲染EPUB内容
async function renderEpubContent(book) {
    try {
        // 获取当前章节
        const chapter = book.chapters[book.currentChapterIndex];
        if (!chapter) {
            console.error('当前章节不存在');
            return;
        }
        
        // 获取书籍元素
        const bookElement = document.querySelector(`[data-book-id="${book.id}"]`);
        if (!bookElement) {
            console.error('书籍元素不存在');
            return;
        }
        
        // 获取内容容器
        const contentContainer = bookElement.querySelector('.book-pages');
        if (!contentContainer) {
            console.error('内容容器不存在');
            return;
        }
        
        // 根据书籍类型获取章节内容
        let htmlContent;
        if (book.fileType === 'epub') {
            // 从ZIP中读取章节文件
            const chapterFile = book.zip.file(chapter.path);
            if (!chapterFile) {
                console.error(`章节文件不存在: ${chapter.path}`);
                return;
            }
            htmlContent = await chapterFile.async('text');
        } else if (book.fileType === 'epub-unzipped') {
            // 从解压的文件夹中读取章节文件
            const chapterFile = book.files.find(file => 
                file.name === chapter.path || 
                file.webkitRelativePath.endsWith(`/${chapter.path}`) ||
                file.webkitRelativePath === chapter.path
            );
            
            if (!chapterFile) {
                console.error(`章节文件不存在: ${chapter.path}`);
                return;
            }
            
            htmlContent = await readFileAsText(chapterFile);
        }
        
        // 处理HTML内容
        const processedHtml = await processHtmlContent(htmlContent, book, chapter.path);
        
        // 更新内容
        contentContainer.innerHTML = processedHtml;
        
        // 增强图片显示
        enhanceImages(contentContainer);
        
        // 更新章节信息
        updateChapterInfo(book);
    } catch (error) {
        console.error('渲染EPUB内容时出错:', error);
        updateStatus('渲染EPUB内容时出错');
    }
}

// 处理HTML内容，修复图片和链接
async function processHtmlContent(htmlContent, book, chapterPath) {
    try {
        // 创建临时DOM元素来处理HTML
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = htmlContent;
        
        // 移除所有外部CSS链接
        const styleLinks = tempDiv.querySelectorAll('link[rel="stylesheet"]');
        styleLinks.forEach(link => link.remove());
        
        // 处理标题样式
        const headings = tempDiv.querySelectorAll('h1, h2, h3, h4, h5, h6');
        headings.forEach(heading => {
            heading.style.color = '#333';
            heading.style.marginTop = '20px';
            heading.style.marginBottom = '10px';
            heading.style.fontWeight = 'bold';
        });
        
        // 处理列表样式
        const lists = tempDiv.querySelectorAll('ul, ol');
        lists.forEach(list => {
            list.style.marginLeft = '20px';
            list.style.marginBottom = '10px';
        });
        
        // 获取所有图片元素
        const imgElements = tempDiv.querySelectorAll('img');
        
        // 处理图片
        for (const img of imgElements) {
            let src = img.getAttribute('src');
            if (!src) continue;
            
            // 跳过绝对URL
            if (src.startsWith('http://') || src.startsWith('https://')) {
                continue;
            }
            
            // 构建完整的图片路径
            const baseDir = chapterPath.substring(0, chapterPath.lastIndexOf('/'));
            let imgPath = baseDir ? `${baseDir}/${src}` : src;
            
            // 处理相对路径
            if (src.startsWith('../')) {
                let relativeParts = src.split('../');
                let cleanBaseDir = baseDir;
                
                // 移除相对路径中的../部分
                for (let i = 1; i < relativeParts.length; i++) {
                    cleanBaseDir = cleanBaseDir.substring(0, cleanBaseDir.lastIndexOf('/'));
                }
                
                // 获取剩余的路径部分
                const remainingPath = relativeParts[relativeParts.length - 1];
                imgPath = cleanBaseDir ? `${cleanBaseDir}/${remainingPath}` : remainingPath;
            }
            
            // 根据书籍类型获取图片数据
            try {
                let imgBlob;
                if (book.fileType === 'epub') {
                    // 从ZIP中读取图片
                    const imgFile = book.zip.file(imgPath);
                    if (imgFile) {
                        const arrayBuffer = await imgFile.async('arraybuffer');
                        imgBlob = new Blob([arrayBuffer]);
                    }
                } else if (book.fileType === 'epub-unzipped') {
                    // 从解压的文件夹中读取图片
                    const imgFile = book.files.find(file => 
                        file.name === imgPath || 
                        file.webkitRelativePath.endsWith(`/${imgPath}`) ||
                        file.webkitRelativePath === imgPath
                    );
                    
                    if (imgFile) {
                        imgBlob = imgFile;
                    }
                }
                
                // 如果找到图片，创建Data URL
                if (imgBlob) {
                    const imgUrl = URL.createObjectURL(imgBlob);
                    img.setAttribute('src', imgUrl);
                }
            } catch (error) {
                console.error('处理图片时出错:', error);
            }
        }
        
        // 处理链接
        const links = tempDiv.querySelectorAll('a');
        links.forEach(link => {
            const href = link.getAttribute('href');
            if (href) {
                // 跳过外部链接
                if (href.startsWith('http://') || href.startsWith('https://')) {
                    return;
                }
                
                // 处理内部链接
                if (book.fileType === 'epub' || book.fileType === 'epub-unzipped') {
                    link.addEventListener('click', (e) => {
                        e.preventDefault();
                        
                        // 解析链接目标
                        const targetPath = simplifyPath(chapterPath, href);
                        
                        // 查找目标章节
                        const targetChapterIndex = book.chapters.findIndex(chapter => 
                            chapter.path === targetPath
                        );
                        
                        if (targetChapterIndex !== -1) {
                            // 更新当前章节并重新渲染
                            book.currentChapterIndex = targetChapterIndex;
                            renderBookContent(book);
                        }
                    });
                }
            }
        });
        
        return tempDiv.innerHTML;
    } catch (error) {
        console.error('处理HTML内容时出错:', error);
        return htmlContent;
    }
}

// 渲染PDF内容
async function renderPdfContent(book) {
    try {
        // 获取书籍元素
        const bookElement = document.querySelector(`[data-book-id="${book.id}"]`);
        if (!bookElement) {
            console.error('书籍元素不存在');
            return;
        }
        
        // 获取内容容器
        const contentContainer = bookElement.querySelector('.book-pages');
        if (!contentContainer) {
            console.error('内容容器不存在');
            return;
        }
        
        // 清空内容容器
        contentContainer.innerHTML = '';
        
        // 设置PDF.js工作器路径
        if (typeof pdfjsLib !== 'undefined' && pdfjsLib.GlobalWorkerOptions) {
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';
        }
        
        // 加载PDF文档
        const loadingTask = pdfjsLib.getDocument(book.arrayBuffer);
        const pdfDocument = await loadingTask.promise;
        
        // 更新书籍信息
        book.totalPages = pdfDocument.numPages;
        
        // 如果当前页面索引超出范围，重置为0
        if (book.currentPageIndex >= book.totalPages) {
            book.currentPageIndex = 0;
        }
        
        // 渲染当前页面
        const pageNumber = book.currentPageIndex + 1;
        const page = await pdfDocument.getPage(pageNumber);
        
        // 设置缩放比例
        const scale = 1.5;
        const viewport = page.getViewport({ scale: scale });
        
        // 创建画布元素
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        
        // 设置画布尺寸
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        
        // 添加画布到内容容器
        contentContainer.appendChild(canvas);
        
        // 渲染页面到画布
        const renderContext = {
            canvasContext: context,
            viewport: viewport
        };
        
        await page.render(renderContext).promise;
        
        // 更新章节信息（PDF中显示页数）
        updateChapterInfo(book);
        
        // 添加滚动事件，用于连续滚动模式
        contentContainer.addEventListener('scroll', function() {
            const scrollTop = contentContainer.scrollTop;
            const scrollHeight = contentContainer.scrollHeight;
            const clientHeight = contentContainer.clientHeight;
            
            // 当滚动到页面底部时，加载下一页
            if (scrollTop + clientHeight >= scrollHeight - 50) {
                if (book.currentPageIndex < book.totalPages - 1) {
                    // 预加载下一页
                    loadNextPdfPage(book, pdfDocument, contentContainer);
                }
            }
        });
    } catch (error) {
        console.error('渲染PDF内容时出错:', error);
        updateStatus('渲染PDF内容时出错');
    }
}

// 加载下一页PDF
async function loadNextPdfPage(book, pdfDocument, contentContainer) {
    try {
        // 检查是否已经在加载中
        if (contentContainer.dataset.loadingNext) {
            return;
        }
        
        // 标记为正在加载
        contentContainer.dataset.loadingNext = 'true';
        
        // 获取下一页
        const nextPageIndex = book.currentPageIndex + 1;
        if (nextPageIndex >= book.totalPages) {
            // 已经是最后一页
            contentContainer.dataset.loadingNext = 'false';
            return;
        }
        
        // 加载下一页
        const page = await pdfDocument.getPage(nextPageIndex + 1);
        
        // 设置缩放比例
        const scale = 1.5;
        const viewport = page.getViewport({ scale: scale });
        
        // 创建画布元素
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        
        // 设置画布尺寸
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        
        // 添加画布到内容容器
        contentContainer.appendChild(canvas);
        
        // 渲染页面到画布
        const renderContext = {
            canvasContext: context,
            viewport: viewport
        };
        
        await page.render(renderContext).promise;
        
        // 更新当前页面索引
        book.currentPageIndex = nextPageIndex;
        
        // 更新章节信息
        updateChapterInfo(book);
        
        // 取消加载标记
        contentContainer.dataset.loadingNext = 'false';
    } catch (error) {
        console.error('加载下一页PDF时出错:', error);
        contentContainer.dataset.loadingNext = 'false';
    }
}

// 随机化当前书籍的章节
function randomizeCurrentBookChapter() {
    const book = appState.currentBook;
    if (!book) {
        displayRandomBook();
        return;
    }
    
    try {
        // 根据书籍类型随机选择章节/页面
        if (book.fileType === 'pdf') {
            // 随机选择PDF页面
            if (book.totalPages && book.totalPages > 0) {
                const randomPageIndex = Math.floor(Math.random() * book.totalPages);
                book.currentPageIndex = randomPageIndex;
            }
        } else {
            // 随机选择EPUB章节
            if (book.chapters && book.chapters.length > 0) {
                const randomChapterIndex = Math.floor(Math.random() * book.chapters.length);
                book.currentChapterIndex = randomChapterIndex;
            }
        }
        
        // 重新渲染书籍内容
        renderBookContent(book);
        
        // 更新状态
        updateStatus(`正在阅读: ${book.title}（随机${book.fileType === 'pdf' ? '页面' : '章节'}）`);
    } catch (error) {
        console.error('随机选择章节/页面时出错:', error);
        updateStatus('随机选择章节/页面时出错');
    }
}

// 调整字体大小
function adjustFontSize(book, direction) {
    if (!book) return;
    
    // 获取书籍元素
    const bookElement = document.querySelector(`[data-book-id="${book.id}"]`);
    if (!bookElement) return;
    
    const pagesElement = bookElement.querySelector('.book-pages');
    if (!pagesElement) return;
    
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

// 导航书籍（上一章/下一章或上一页/下一页）
async function navigateBook(book, direction) {
    if (!book) {
        console.error('No book provided');
        return;
    }
    
    try {
        // 获取当前书籍元素
        const bookElement = document.querySelector(`[data-book-id="${book.id}"]`);
        
        // 根据书籍类型进行导航
        if (book.fileType === 'pdf') {
            // PDF导航（页面）
            const newPageIndex = book.currentPageIndex + direction;
            
            // 检查边界
            if (book.totalPages && newPageIndex >= 0 && newPageIndex < book.totalPages) {
                book.currentPageIndex = newPageIndex;
                await renderBookContent(book);
            }
        } else {
            // EPUB导航（章节）
            const newChapterIndex = book.currentChapterIndex + direction;
            
            // 检查边界
            if (book.chapters && book.chapters.length > 0 && newChapterIndex >= 0 && newChapterIndex < book.chapters.length) {
                book.currentChapterIndex = newChapterIndex;
                await renderBookContent(book);
                
                // 更新章节下拉菜单
                if (bookElement) {
                    updateChapterDropdown(bookElement, book);
                }
            }
        }
        
        // 更新章节信息
        updateChapterInfo(book);
        
    } catch (error) {
        console.error('导航书籍时出错:', error);
        updateStatus('导航书籍时出错');
    }
}

// 更新章节信息
function updateChapterInfo(book) {
    if (!book) {
        return;
    }
    
    // 获取书籍元素
    const bookElement = document.querySelector(`[data-book-id="${book.id}"]`);
    if (!bookElement) {
        return;
    }
    
    // 获取章节信息元素
    const chapterInfo = bookElement.querySelector('.chapter-info');
    if (!chapterInfo) {
        return;
    }
    
    // 根据书籍类型更新章节信息
    if (book.fileType === 'pdf') {
        chapterInfo.textContent = `第 ${book.currentPageIndex + 1} 页 / 共 ${book.totalPages} 页`;
    } else {
        chapterInfo.textContent = `第 ${book.currentChapterIndex + 1} 章 / 共 ${book.totalChapters} 章`;
    }
}

// 切换章节下拉框显示/隐藏
function toggleChapterDropdown(book) {
    const bookElement = document.querySelector(`[data-book-id="${book.id}"]`);
    const dropdown = bookElement?.querySelector('.chapter-dropdown');
    if (dropdown) {
        dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block';
    }
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

// 增强图片显示
function enhanceImages(container) {
    if (!container) {
        console.warn('增强图片时容器为空');
        return;
    }
    
    try {
        // 获取所有图片元素
        const images = container.querySelectorAll('img');
        
        if (images.length === 0) {
            return;
        }
        
        // 为每张图片添加点击事件，实现放大查看功能
        images.forEach(img => {
            // 设置图片样式，使其可以调整大小
            img.style.maxWidth = '100%';
            img.style.height = 'auto';
            img.style.cursor = 'pointer';
            img.style.transition = 'transform 0.3s ease';
            img.style.display = 'block';
            img.style.margin = '10px auto';
            
            // 添加加载失败处理
            img.addEventListener('error', function() {
                this.style.border = '2px solid red';
                this.style.padding = '5px';
                this.title = '图片加载失败';
            });
            
            // 添加点击事件
            img.addEventListener('click', function() {
                // 切换图片的放大状态
                if (this.classList.contains('enlarged')) {
                    this.classList.remove('enlarged');
                    this.style.transform = 'scale(1)';
                    this.style.position = 'static';
                    this.style.zIndex = 'auto';
                    this.style.boxShadow = 'none';
                    this.style.maxWidth = '100%';
                } else {
                    this.classList.add('enlarged');
                    this.style.transform = 'scale(1.5)';
                    this.style.position = 'relative';
                    this.style.zIndex = '1000';
                    this.style.boxShadow = '0 0 20px rgba(0, 0, 0, 0.5)';
                    this.style.maxWidth = '90%';
                    this.style.margin = '0 auto';
                }
            });
        });
    } catch (error) {
        console.error('增强图片时出错:', error);
    }
}

// 更新状态
function updateStatus(message) {
    if (statusText) {
        statusText.textContent = message;
    }
}

// 当DOM加载完成后初始化应用
document.addEventListener('DOMContentLoaded', initApp);

// 简化路径，处理相对路径
function simplifyPath(basePath, relativePath) {
    if (relativePath.startsWith('/')) {
        return relativePath.substring(1); // 如果是绝对路径，移除开头的斜杠
    }
    
    const baseParts = basePath.split('/').filter(Boolean);
    const relativeParts = relativePath.split('/').filter(Boolean);
    
    // 移除文件名部分（如果有）
    if (baseParts.length > 0 && !basePath.endsWith('/')) {
        baseParts.pop();
    }
    
    // 处理相对路径
    for (const part of relativeParts) {
        if (part === '..') {
            if (baseParts.length > 0) {
                baseParts.pop();
            }
        } else if (part !== '.') {
            baseParts.push(part);
        }
    }
    
    return baseParts.join('/');
}

// 更新章节下拉菜单
function updateChapterDropdown(bookElement, book) {
    if (book.fileType !== 'epub' && book.fileType !== 'epub-unzipped') return;
    
    const dropdown = bookElement.querySelector('.chapter-dropdown');
    if (!dropdown) return;
    
    // 更新所有章节项的active状态
    dropdown.querySelectorAll('.chapter-dropdown-item').forEach(item => {
        const chapterIndex = parseInt(item.dataset.chapterIndex);
        if (chapterIndex === book.currentChapterIndex) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });
}

// 生成章节下拉菜单
function generateChapterDropdown(bookElement, book) {
    if (book.fileType !== 'epub' && book.fileType !== 'epub-unzipped') return;
    if (!book.chapters || book.chapters.length === 0) return;
    
    const dropdown = bookElement.querySelector('.chapter-dropdown');
    if (!dropdown) return;
    
    // 清空下拉菜单
    dropdown.innerHTML = '';
    
    // 添加所有章节
    book.chapters.forEach((chapter, index) => {
        const chapterItem = document.createElement('div');
        chapterItem.className = 'chapter-dropdown-item';
        chapterItem.dataset.chapterIndex = index;
        chapterItem.textContent = `第 ${index + 1} 章`;
        
        // 如果是当前章节，添加active类
        if (index === book.currentChapterIndex) {
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
    if (book.fileType !== 'epub' && book.fileType !== 'epub-unzipped') return;
    
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

// 选择章节
function selectChapter(bookElement, book, chapterIndex) {
    if (book.fileType !== 'epub' && book.fileType !== 'epub-unzipped') return;
    if (chapterIndex < 0 || chapterIndex >= book.chapters.length) return;
    
    // 更新当前章节索引
    book.currentChapterIndex = chapterIndex;
    
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

// 自动滚动相关功能

// 启动自动滚动
function startAutoScroll(book) {
    if (!book || appState.autoScroll) return;
    
    // 获取书籍元素
    const bookElement = document.querySelector(`[data-book-id="${book.id}"]`);
    if (!bookElement) return;
    
    // 获取内容容器
    const pagesElement = bookElement.querySelector('.book-pages');
    if (!pagesElement) return;
    
    appState.autoScroll = true;
    
    // 更新按钮样式
    updateAutoScrollBtnStyle();
    
    // 开始滚动
    appState.scrollIntervalId = setInterval(() => {
        if (!appState.autoScroll) return;
        
        // 执行滚动
        pagesElement.scrollTop += 1;
        
        // 检测是否触底
        checkScrollEnd(book, pagesElement);
    }, appState.scrollSpeed);
}

// 更新自动滚动按钮样式
function updateAutoScrollBtnStyle() {
    const toggleBtn = document.getElementById('toggleAutoScrollBtn');
    if (!toggleBtn) return;
    
    if (appState.autoScroll) {
        if (appState.loopCurrentBook) {
            // 单本书自动播放状态 - 蓝色
            toggleBtn.style.backgroundColor = 'rgba(33, 150, 243, 0.8)';
            toggleBtn.title = '单本书循环播放 - 双击退出单本书循环，单击退出自动播放';
        } else {
            // 普通自动播放状态 - 绿色
            toggleBtn.style.backgroundColor = 'rgba(76, 175, 80, 0.8)';
            toggleBtn.title = '自动播放 - 双击进入单本书循环，单击退出自动播放';
        }
    } else {
        // 非自动播放状态
        toggleBtn.style.backgroundColor = 'rgba(255, 255, 255, 0.2)';
        toggleBtn.title = '自动播放 - 单击开始自动播放，双击开始单本书循环播放';
    }
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
    updateAutoScrollBtnStyle();
}

// 切换自动滚动状态
function toggleAutoScroll() {
    const currentBook = appState.currentBook;
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
    // 调整幅度为20ms，使变化更明显
    appState.scrollSpeed = Math.max(10, Math.min(200, appState.scrollSpeed - (direction * 20)));
    
    // 更新状态
    updateStatus(`滚动速度已调整为 ${appState.scrollSpeed}ms`);
    
    // 如果当前正在滚动，重启滚动以应用新速度
    if (appState.autoScroll) {
        const currentBook = appState.currentBook;
        if (currentBook) {
            stopAutoScroll();
            startAutoScroll(currentBook);
        }
    }
}

// 检测滚动是否触底
function checkScrollEnd(book, pagesElement) {
    if (!book || !pagesElement) return;
    
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
async function handleScrollEnd(book, contentTooShort = false) {
    if (book.fileType === 'pdf') {
        // PDF处理：如果是最后一页
        if (book.currentPageIndex >= book.totalPages - 1) {
            // 检查是否开启了当前书循环
            if (appState.loopCurrentBook) {
                // 如果内容太短，停顿5秒后再回到第一页
                if (contentTooShort) {
                    setTimeout(async () => {
                        // 回到第一页
                        book.currentPageIndex = 0;
                        await renderBookContent(book);
                        
                        // 重新启动自动滚动
                        setTimeout(() => startAutoScroll(book), 500);
                    }, 5000); // 停顿5秒
                } else {
                    // 回到第一页
                    book.currentPageIndex = 0;
                    await renderBookContent(book);
                    
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
        } else {
            // 如果内容太短，停顿5秒后再切换到下一页
            if (contentTooShort) {
                setTimeout(async () => {
                    // 切换到下一页
                    await navigateBook(book, 1);
                    
                    // 重新启动自动滚动
                    setTimeout(() => startAutoScroll(book), 500);
                }, 5000); // 停顿5秒
            } else {
                // 切换到下一页
                await navigateBook(book, 1);
                
                // 重新启动自动滚动
                setTimeout(() => startAutoScroll(book), 500);
            }
        }
    } else if (book.fileType === 'epub' || book.fileType === 'epub-unzipped') {
        // EPUB处理：如果是最后一个章节
        if (book.currentChapterIndex >= book.totalChapters - 1) {
            // 检查是否开启了当前书循环
            if (appState.loopCurrentBook) {
                // 如果内容太短，停顿5秒后再回到第一章
                if (contentTooShort) {
                    setTimeout(async () => {
                        // 回到第一章
                        book.currentChapterIndex = 0;
                        await renderBookContent(book);
                        
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
                    // 回到第一章
                    book.currentChapterIndex = 0;
                    await renderBookContent(book);
                    
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
        } else {
            // 如果内容太短，停顿5秒后再切换到下一章节
            if (contentTooShort) {
                setTimeout(async () => {
                    // 切换到下一章节
                    await navigateBook(book, 1);
                    
                    // 重新启动自动滚动
                    setTimeout(() => startAutoScroll(book), 500);
                }, 5000); // 停顿5秒
            } else {
                // 切换到下一章节
                await navigateBook(book, 1);
                
                // 重新启动自动滚动
                setTimeout(() => startAutoScroll(book), 500);
            }
        }
    }
}

// 切换到下一本书
async function switchToNextBook() {
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
    
    // 设置为第一章或第一页
    if (nextBook.fileType === 'pdf') {
        nextBook.currentPageIndex = 0;
    } else {
        nextBook.currentChapterIndex = 0;
    }
    
    // 显示新书
    await displayBook(nextBook);
    
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
    
    // 全局双击事件委托，处理自动滚动按钮双击
    document.addEventListener('dblclick', function(e) {
        // 处理自动滚动按钮双击
        if (e.target.id === 'toggleAutoScrollBtn') {
            // 切换当前书循环模式
            toggleLoopCurrentBook();
        }
    });
}

// 切换当前书循环模式
function toggleLoopCurrentBook() {
    const currentBook = appState.currentBook;
    if (!currentBook) return;
    
    // 如果当前不是自动播放状态，先启动自动播放
    if (!appState.autoScroll) {
        startAutoScroll(currentBook);
        // 直接开启单本书循环
        appState.loopCurrentBook = true;
    } else {
        // 如果已经是自动播放状态，切换单本书循环状态
        appState.loopCurrentBook = !appState.loopCurrentBook;
    }
    
    // 更新按钮样式
    updateAutoScrollBtnStyle();
    
    // 更新状态
    updateStatus(appState.loopCurrentBook ? '已开启单本书循环播放' : '已关闭单本书循环播放，当前为普通自动播放');
}