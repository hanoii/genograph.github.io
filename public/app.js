'use strict';
/* ============================================================
 * Genograph — browser UI (ES module)
 * Persists through a pluggable store chosen at startup by ./lib/storage.js
 * (local server, a real folder via File System Access, or IndexedDB). All data
 * logic lives in ./lib/model.js and the layout in ./lib/layout.js.
 * ============================================================ */

import {
  buildModel, serialize, rootIdOf, setRootId, validateTree, TREE_LIMITS,
  birthSortIds, siblingIds, norm, searchText, yearOf, ageOf, CAUSES, DATE_RE
} from './lib/model.js';
import { layout, CARD_W, CARD_H } from './lib/layout.js';
import { pickStore, openFolder, supportsFolders } from './lib/storage.js';
import { initialLanguage } from './lib/i18n.js';
import { SaveCoordinator } from './lib/autosave.js';
import { viewReport } from './lib/report.js';
import { assertCanLinkSiblings, assertCanSetParent, linkSiblings, linkSpouses, setParent, unlinkParentChild, unlinkSpouses } from './lib/relationships.js';

/* Browsers ignore frame-ancestors in a <meta> CSP, and the static host cannot
 * send headers, so refuse to run framed (anti-clickjacking) here instead.
 * The local Node server additionally enforces this with a real CSP header. */
if (window.top !== window.self) {
  try { window.top.location.replace(window.location.href); } catch { /* cross-origin parent */ }
  throw new Error('Genograph does not run inside a frame.');
}

/* ---------------- i18n ---------------- */
const I18N = {
  tr: {
    title: 'Aile Ağacı', modeFull: 'Tüm Aile', modeClose: 'Yakın Aile', modeAnc: 'Atalar',
    search: 'Kişi ara…', saved: 'Kaydedildi', saving: 'Kaydediliyor…', unsaved: 'Kaydedilmedi ●', saveErr: 'Kayıt hatası!',
    layoutTooComplex: 'Bu ilişki ağı güvenle çizilemeyecek kadar karmaşık.',
    relationshipCycle: 'Bu ilişki bir soy döngüsü oluşturur ve eklenemez.',
    relationshipInvalid: 'Bu ilişki eklenemez.',
    cardHelp: '{n}. Düzenlemek için Enter, odaklamak için Shift+Enter.',
    zoomInLabel: 'Yakınlaştır', zoomOutLabel: 'Uzaklaştır',
    name: 'Ad Soyad', sex: 'Cinsiyet', male: 'Erkek', female: 'Kadın',
    birthDate: 'Doğum tarihi', birthPlace: 'Doğum yeri', deathDate: 'Ölüm tarihi', deathPlace: 'Ölüm yeri',
    burialPlace: 'Defin yeri', occupation: 'Meslek', notes: 'Notlar', notesPh: 'Görüşme notları…', deceased: 'Vefat etmiş',
    father: 'Baba', mother: 'Anne', spouses: 'Eş(ler)', children: 'Çocuklar', siblings: 'Kardeşler',
    addChild: 'Çocuk ekle', addSpouse: 'Eş ekle', addFather: 'Baba ekle', addMother: 'Anne ekle', addSibling: 'Kardeş ekle', addPerson: 'Yeni kişi ekle',
    focusHere: 'Odakla', setDefault: 'Varsayılan yap', defaultSetSnack: 'Varsayılan kişi {n} olarak ayarlandı',
    del: 'Sil', confirmDelTitle: 'Kişi silinsin mi?',
    confirmDelMsg: '"{n}" ağaçtan ve dosyadan kalıcı olarak silinecek. (Eski yedekler backups klasöründe durur.)',
    confirmDelMsgBrowser: '"{n}" ağaçtan kalıcı olarak silinecek.',
    cancel: 'Vazgeç', add: 'Ekle', link: 'Bağla', ok: 'Tamam',
    otherParent: 'Diğer ebeveyn', nonePar: '(belirtilme)',
    relChild: 'Yeni kişi → {n} kişisinin çocuğu', relSpouse: 'Yeni kişi → {n} kişisinin eşi',
    relFather: 'Yeni kişi → {n} kişisinin babası', relMother: 'Yeni kişi → {n} kişisinin annesi',
    relSibling: 'Yeni kişi → {n} kişisinin kardeşi',
    relNone: 'Bağımsız kişi (sonradan bağlanabilir)',
    existingHint: 'Yazarken listeden mevcut bir kişiyi seçersen, yeni kişi yerine o bağlanır.',
    notInTree: 'Bu kişi şu anki görünümde yer almıyor — görmek için "Odakla".',
    rootBadge: 'Kök kişi', ancBadge: 'Doğrudan ata',
    uncertain: 'tahmini', theme: 'Koyu / açık tema', focusOn: 'Odak',
    clearFocus: 'Odağı kaldır — tüm ağaca dön',
    birthCountry: 'Doğum ülkesi', deathCountry: 'Ölüm ülkesi',
    aliases: 'Lakap / diğer adlar', maidenName: 'Kızlık soyadı',
    deathCause: 'Ölüm nedeni', deathCauseDetail: 'Neden ayrıntısı', notSet: '(seçilmedi)',
    illegit: 'Evlilik dışı çocuğu var(dı)',
    cause_natural: 'Doğal / yaşlılık', cause_illness: 'Hastalık', cause_accident: 'Kaza',
    cause_war: 'Savaş / çatışma', cause_childbirth: 'Doğum', cause_homicide: 'Cinayet',
    cause_suicide: 'İntihar', cause_unknown: 'Bilinmiyor', cause_other: 'Diğer',
    people: 'kişi', shown: 'görünüyor', fit: 'Sığdır', home: 'Kök kişiye dön',
    addedSnack: 'Eklendi: {n}', linkedSnack: 'Bağlandı: {n}', deletedSnack: 'Silindi: {n}',
    unlinkTitle: 'Bağlantı kaldırılsın mı?', unlinkMsg: '{a} ile {b} artık bağlı olmayacak. İki kişi de ağaçta kalır.',
    unlinkOk: 'Bağlantıyı kaldır', unlinkLabel: '{n} bağlantısını kaldır', unlinkedSnack: 'Bağlantı kaldırıldı: {a} – {b}',
    fabTitle: 'Yeni kişi ekle', dblFocus: 'Çift tıkla: bu kişiye odaklan', closePanel: 'Kapat',
    noResults: 'Sonuç yok', offTree: 'ağaç dışı', born: 'd.', died: 'ö.',
    ageY: '{y}y', ageM: '{m}a', ageYM: '{y}y {m}a', age: 'Yaş', ageAtDeath: 'Ölüm yaşı',
    // tree library
    newTree: 'Yeni ağaç', importTreeBtn: 'JSON içe aktar…', renameTree: 'Yeniden adlandır',
    duplicateTree: 'Çoğalt', exportTree: 'JSON dışa aktar', deleteTreeBtn: 'Ağacı sil',
    newTreeTitle: 'Yeni ağaç', renameTreeTitle: 'Ağacı yeniden adlandır',
    confirmDelTreeTitle: 'Bu ağaç silinsin mi?',
    confirmDelTreeMsg: '"{n}" veri klasöründeki çöp kutusuna taşınacak.',
    confirmDelTreeMsgBrowser: '"{n}" bu tarayıcının depolamasından kalıcı olarak silinecek. Bir kopya istiyorsanız önce JSON olarak dışa aktarın.',
    treeCreated: 'Oluşturuldu: {n}', treeImported: 'İçe aktarıldı: {n}', treeDeleted: 'Silindi: {n}', treeRenamed: 'Yeniden adlandırıldı',
    importInvalid: 'Bu dosya geçerli bir ağaç değil ("people" listesi gerekli).', importFailed: 'İçe aktarma başarısız',
    loadError: 'Ağaç yüklenemedi',
    emptyNoPeopleTitle: 'Bu ağaç boş', emptyNoPeopleMsg: 'Oluşturmaya başlamak için ilk kişiyi ekleyin.', emptyNoPeopleAction: 'İlk kişiyi ekle',
    emptyNoTreeTitle: 'Henüz ağaç yok', emptyNoTreeMsg: 'İlk aile ağacınızı oluşturun.', emptyNoTreeAction: 'Yeni ağaç',
    // data folder
    save: 'Kaydet', dataFolder: 'Veri klasörü', dataFolderTitle: 'Veri klasörü',
    dataCurrentLabel: 'Ağaçlarınız şu anda burada saklanıyor:',
    dataPathLabel: 'Ağaçları bunun yerine bu klasöre kaydet',
    dataHint: 'Tam bir yol yazın (örn. ~/Desktop/aile-agaci). Klasör yoksa oluşturulur. Mevcut klasörü korumak için boş bırakın.',
    dataMove: 'Mevcut ağaçlarımı yeni klasöre taşı',
    dataLockedMsg: 'Klasör, bu oturum için --data bayrağı veya GENOGRAPH_DATA değişkeniyle sabitlendi, bu yüzden buradan değiştirilemez.',
    dataChanged: 'Veri klasörü değiştirildi', dataMovedSnack: '{n} ağaç yeni klasöre taşındı',
    // browser storage (static / no server)
    storageLabel: 'Depolama', folderLabel: 'Klasör',
    storedInBrowser: 'Bu tarayıcıda saklanıyor — yedeklemek için dışa aktarın',
    openFolderBtn: 'Klasör aç', changeFolderBtn: 'Klasörü değiştir',
    folderConnected: 'Klasöre kaydediliyor: {n}', folderError: 'Klasör açılamadı',
    // welcome / onboarding
    welcomeHelp: 'Genograph hakkında & yardım',
    welcomeTitle: 'Genograph’a hoş geldiniz',
    welcomeIntro: 'Gizliliğe önem veren bir aile ağacı aracı. Kişileri, tarihleri, yerleri, ilişkileri ve görüşme notlarını kaydedin. Hesap yok, bulut yok, takip yok — verileriniz cihazınızdan ayrılmaz.',
    welcomeExploring: 'Şu anda hemen deneyebilmeniz için bir örnek ağaç görüyorsunuz (Kudüs Kralı Guy de Lusignan’ın yakın akrabaları).',
    welcomeUse1Title: 'Bir kişiye tıklayın',
    welcomeUse1: '— ad, cinsiyet, tarihler, yerler ve notları düzenlemek için yan paneli açar.',
    welcomeUse2Title: 'Akraba ekleyin',
    welcomeUse2: '— paneldeki + düğmelerini (baba, anne, eş, çocuk, kardeş) ya da tuvaldeki + düğmesini kullanın.',
    welcomeUse3Title: 'Kendi ağaçlarınızı oluşturun',
    welcomeUse3: '— sol üstteki ağaç menüsünden ağaç oluşturun, yeniden adlandırın, içe/dışa aktarın.',
    welcomeTips: 'İpuçları: kaydırmak için sürükleyin · yakınlaştırmak için tekerleği kullanın · bir kişiye odaklanmak için çift tıklayın · sağ üstten arayın.',
    welcomePrivacy: 'Verileriniz bu cihazda kalır ve istediğiniz zaman tamamen size ait düz JSON olarak dışa aktarılabilir.',
    welcomeLocalTitle: 'Gerçek dosyalar ve otomatik yedekler mi istiyorsunuz?',
    welcomeLocal: 'Ücretsiz yerel sürümü çalıştırın: ağaçlarınızı doğrudan bilgisayarınızdaki .json dosyalarına yazar ve otomatik yedek tutar. Tamamen çevrimdışı çalışır.',
    welcomeCopy: 'Kopyala', welcomeCopied: 'Kopyalandı ✓',
    welcomeStart: 'Keşfetmeye başla',
    // print
    printView: 'Bu görünümü yazdır / PDF olarak kaydet', printTitle: 'Bu görünümü yazdır',
    printViewHint: '{n} için {v} görünümü: {c} kişi, kuşak kuşak, ekranda çizildikleri sırayla.',
    printNotes: 'Notları dahil et', printHideLiving: 'Yaşayan kişilerin ayrıntılarını gizle',
    printPdfHint: 'PDF dosyası için yazdırma penceresinde "PDF olarak kaydet"i seçin.', printBtn: 'Yazdır',
    reportPeople: '{n} kişi', reportPrinted: 'Yazdırılma: {d}',
    reportAbout: 'yakl.', reportBorn: 'Doğum', reportDied: 'Ölüm', reportBuried: 'Defin',
    reportStatus: 'Durum', reportLiving: 'Yaşıyor; ayrıntılar gizlendi',
    reportGen0: '{n} kuşağı', reportGenUp1: 'Anne-baba kuşağı', reportGenUp2: 'Büyükanne-büyükbaba kuşağı',
    reportGenUp3: 'Büyük büyükanne-büyükbaba kuşağı', reportGenUpN: '{d} kuşak yukarı',
    reportGenDown1: 'Çocuklar kuşağı', reportGenDown2: 'Torunlar kuşağı', reportGenDown3: 'Torun çocukları kuşağı',
    reportGenDownN: '{d} kuşak aşağı',
    printLayout: 'Düzen', printDetailed: 'Ayrıntılı', printDetailedHint: 'Kişi başına tam kayıt: bilgiler, akrabalar ve notlar',
    printCompact: 'Kompakt', printCompactHint: 'Kişi başına bir tablo satırı; bir görünüm bir iki sayfaya sığar',
    reportParents: 'Anne-baba', reportLivingShort: 'Yaşıyor', reportMonths: '{m} ay',
    reportAhnentafel: 'Ahnentafel numaraları: bir kişinin babası numarasının iki katı, annesi iki katının bir fazlasıdır.'
  },
  en: {
    title: 'Family Tree', modeFull: 'Whole Family', modeClose: 'Close Family', modeAnc: 'Ancestors',
    search: 'Search people…', saved: 'Saved', saving: 'Saving…', unsaved: 'Unsaved ●', saveErr: 'Save failed!',
    layoutTooComplex: 'This relationship graph is too complex to lay out safely.',
    relationshipCycle: 'That relationship would create an ancestry cycle.',
    relationshipInvalid: 'That relationship cannot be added.',
    cardHelp: '{n}. Press Enter to edit; Shift+Enter to focus.',
    zoomInLabel: 'Zoom in', zoomOutLabel: 'Zoom out',
    name: 'Full name', sex: 'Sex', male: 'Male', female: 'Female',
    birthDate: 'Birth date', birthPlace: 'Birth place', deathDate: 'Death date', deathPlace: 'Death place',
    burialPlace: 'Burial place', occupation: 'Occupation', notes: 'Notes', notesPh: 'Interview notes…', deceased: 'Deceased',
    father: 'Father', mother: 'Mother', spouses: 'Spouse(s)', children: 'Children', siblings: 'Siblings',
    addChild: 'Add child', addSpouse: 'Add spouse', addFather: 'Add father', addMother: 'Add mother', addSibling: 'Add sibling', addPerson: 'Add person',
    focusHere: 'Focus', setDefault: 'Set as default', defaultSetSnack: 'Default person set to {n}',
    del: 'Delete', confirmDelTitle: 'Delete person?',
    confirmDelMsg: '"{n}" will be permanently removed from the tree and the file. (Old backups stay in the backups folder.)',
    confirmDelMsgBrowser: '"{n}" will be permanently removed from the tree.',
    cancel: 'Cancel', add: 'Add', link: 'Link', ok: 'OK',
    otherParent: 'Other parent', nonePar: '(unspecified)',
    relChild: 'New person → child of {n}', relSpouse: 'New person → spouse of {n}',
    relFather: 'New person → father of {n}', relMother: 'New person → mother of {n}',
    relSibling: 'New person → sibling of {n}',
    relNone: 'Unconnected person (can be linked later)',
    existingHint: 'Pick a person from the list while typing to link an existing person instead.',
    notInTree: 'This person is not in the current view — press "Focus" to see them.',
    rootBadge: 'Root person', ancBadge: 'Direct ancestor',
    uncertain: 'approx.', theme: 'Dark / light theme', focusOn: 'Focus',
    clearFocus: 'Clear focus — back to the whole tree',
    birthCountry: 'Birth country', deathCountry: 'Death country',
    aliases: 'Nickname / aliases', maidenName: 'Maiden name',
    deathCause: 'Cause of death', deathCauseDetail: 'Cause detail', notSet: '(not set)',
    illegit: 'Had child(ren) out of wedlock',
    cause_natural: 'Natural / old age', cause_illness: 'Illness', cause_accident: 'Accident',
    cause_war: 'War / conflict', cause_childbirth: 'Childbirth', cause_homicide: 'Homicide',
    cause_suicide: 'Suicide', cause_unknown: 'Unknown', cause_other: 'Other',
    people: 'people', shown: 'shown', fit: 'FIT', home: 'Back to the root person',
    addedSnack: 'Added: {n}', linkedSnack: 'Linked: {n}', deletedSnack: 'Deleted: {n}',
    unlinkTitle: 'Remove link?', unlinkMsg: '{a} and {b} will no longer be linked. Both people stay in the tree.',
    unlinkOk: 'Remove link', unlinkLabel: 'Remove link to {n}', unlinkedSnack: 'Link removed: {a} – {b}',
    fabTitle: 'Add person', dblFocus: 'Double-click to focus on this person', closePanel: 'Close',
    noResults: 'No results', offTree: 'off-tree', born: 'b.', died: 'd.',
    ageY: '{y}y', ageM: '{m}m', ageYM: '{y}y {m}m', age: 'Age', ageAtDeath: 'Age at death',
    // tree library
    newTree: 'New tree', importTreeBtn: 'Import JSON…', renameTree: 'Rename',
    duplicateTree: 'Duplicate', exportTree: 'Export JSON', deleteTreeBtn: 'Delete tree',
    newTreeTitle: 'New tree', renameTreeTitle: 'Rename tree',
    confirmDelTreeTitle: 'Delete this tree?',
    confirmDelTreeMsg: '"{n}" will be moved to the trash folder inside your data directory.',
    confirmDelTreeMsgBrowser: '"{n}" will be permanently deleted from this browser\'s storage. Export it as JSON first if you want a copy.',
    treeCreated: 'Created: {n}', treeImported: 'Imported: {n}', treeDeleted: 'Deleted: {n}', treeRenamed: 'Renamed',
    importInvalid: 'That file is not a valid tree (it needs a "people" array).', importFailed: 'Import failed',
    loadError: 'Could not load tree',
    emptyNoPeopleTitle: 'This tree is empty', emptyNoPeopleMsg: 'Add the first person to start building it.', emptyNoPeopleAction: 'Add the first person',
    emptyNoTreeTitle: 'No trees yet', emptyNoTreeMsg: 'Create your first family tree.', emptyNoTreeAction: 'New tree',
    // data folder
    save: 'Save', dataFolder: 'Data folder', dataFolderTitle: 'Data folder',
    dataCurrentLabel: 'Your trees are currently saved in:',
    dataPathLabel: 'Save trees in this folder instead',
    dataHint: 'Type a full path (e.g. ~/Desktop/family-trees). The folder is created if it doesn’t exist. Leave blank to keep the current one.',
    dataMove: 'Move my current trees into the new folder',
    dataLockedMsg: 'The folder is fixed for this session by a --data flag or the GENOGRAPH_DATA variable, so it can’t be changed here.',
    dataChanged: 'Data folder changed', dataMovedSnack: 'Moved {n} tree(s) to the new folder',
    // browser storage (static / no server)
    storageLabel: 'Storage', folderLabel: 'Folder',
    storedInBrowser: 'Stored in this browser — export to back up',
    openFolderBtn: 'Open a folder', changeFolderBtn: 'Change folder',
    folderConnected: 'Saving to folder: {n}', folderError: 'Could not open that folder',
    // welcome / onboarding
    welcomeHelp: 'About Genograph & help',
    welcomeTitle: 'Welcome to Genograph',
    welcomeIntro: 'A private family-tree builder. Record people, dates, places, relationships and interview notes. No account, no cloud, no tracking — your data never leaves your device.',
    welcomeExploring: 'You’re looking at an example tree (the close relatives of Guy de Lusignan, 12th-century King of Jerusalem) so you can try things right away.',
    welcomeUse1Title: 'Click a person',
    welcomeUse1: '— opens the side panel to edit their name, sex, dates, places and notes.',
    welcomeUse2Title: 'Add relatives',
    welcomeUse2: '— use the + buttons in the panel (father, mother, spouse, child, sibling) or the + button on the canvas.',
    welcomeUse3Title: 'Build your own trees',
    welcomeUse3: '— the tree menu (top-left) lets you create, rename, import and export your own family trees.',
    welcomeTips: 'Tips: drag to pan · scroll to zoom · double-click a person to focus the tree on them · search top-right.',
    welcomePrivacy: 'Your data stays on this device and can be exported any time as plain JSON that you fully own.',
    welcomeLocalTitle: 'Want real files & automatic backups?',
    welcomeLocal: 'Run the free local version: it reads and writes your trees as .json files directly on your computer and keeps automatic backups. Works completely offline.',
    welcomeCopy: 'Copy', welcomeCopied: 'Copied ✓',
    welcomeStart: 'Start exploring',
    // print
    printView: 'Print this view / save as PDF', printTitle: 'Print this view',
    printViewHint: '{v} of {n}: {c} people, by generation, in the order they are drawn.',
    printNotes: 'Include notes', printHideLiving: 'Hide details of living people',
    printPdfHint: 'For a PDF file, choose "Save as PDF" in the print dialog.', printBtn: 'Print',
    reportPeople: '{n} people', reportPrinted: 'Printed {d}',
    reportAbout: 'abt.', reportBorn: 'Born', reportDied: 'Died', reportBuried: 'Buried',
    reportStatus: 'Status', reportLiving: 'Living; details withheld',
    reportGen0: 'Generation of {n}', reportGenUp1: 'Parents\' generation', reportGenUp2: 'Grandparents\' generation',
    reportGenUp3: 'Great-grandparents\' generation', reportGenUpN: '{k}× great-grandparents\' generation',
    reportGenDown1: 'Children\'s generation', reportGenDown2: 'Grandchildren\'s generation', reportGenDown3: 'Great-grandchildren\'s generation',
    reportGenDownN: '{k}× great-grandchildren\'s generation',
    printLayout: 'Layout', printDetailed: 'Detailed', printDetailedHint: 'A full entry per person: details, relatives and notes',
    printCompact: 'Compact', printCompactHint: 'One table line per person, so a view fits on a page or two',
    reportParents: 'Parents', reportLivingShort: 'Living', reportMonths: '{m} months',
    reportAhnentafel: 'Ahnentafel numbers: anyone\'s father is twice their number, their mother twice plus one.'
  }
};
const storedLang = localStorage.getItem('ft_lang');
let lang = initialLanguage(storedLang, navigator.language);
let theme = localStorage.getItem('ft_theme') ||
  (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
const MOON_SVG = '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.39 5.39 0 0 1-4.4 2.26 5.4 5.4 0 0 1-3.14-9.8c-.44-.06-.9-.1-1.36-.1z"/></svg>';
const SUN_SVG = '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10zm0-5 2 3h-4l2-3zm0 20-2-3h4l-2 3zM2 12l3-2v4l-3-2zm20 0-3 2v-4l3 2zM4.9 4.9 8.4 6 6 8.4 4.9 4.9zm14.2 14.2L15.6 18l2.4-2.4 1.1 3.5zM4.9 19.1 6 15.6 8.4 18l-3.5 1.1zM19.1 4.9 18 8.4 15.6 6l3.5-1.1z"/></svg>';
// welcome-dialog icons
const BRAND_SVG = '<svg viewBox="0 0 1024 1024" aria-hidden="true"><use href="genograph-logo.svg#logo"></use></svg>';
const W_EDIT_SVG = '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75z"/></svg>';
const W_ADD_SVG = '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z"/></svg>';
const W_TREE_SVG = '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8z"/></svg>';
const W_SHIELD_SVG = '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M12 1 3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5zm-2 16-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9z"/></svg>';
const DEFAULT_SVG = '<svg aria-hidden="true" viewBox="0 0 24 24" width="17" height="17"><path fill="currentColor" d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>';
function applyTheme() {
  document.documentElement.dataset.theme = theme;
  const btn = $('themeBtn');
  if (btn) {
    btn.innerHTML = theme === 'dark' ? SUN_SVG : MOON_SVG;
    btn.title = t('theme');
    btn.setAttribute('aria-label', t('theme'));
  }
}
const t = (k, vars) => {
  let s = (I18N[lang][k] ?? I18N.tr[k] ?? k);
  if (vars) for (const [key, v] of Object.entries(vars)) s = s.replace('{' + key + '}', v);
  return s;
};

/* ---------------- state ---------------- */
const $ = id => document.getElementById(id);
let model = null;            // { raw, people:[], byId:Map }
let trees = [];             // [{ id, name, people, updated_at }]
let settings = null;        // server mode only: { dataDir, defaultDir, configurable, locked }
let store = null;           // active storage backend (server | fs | idb)
let storeMode = 'server';   // 'server' | 'fs' | 'idb'
let savedHandle = null;     // a remembered folder handle awaiting reconnect (browser mode)
let currentTreeId = null;
let focusId = null;
let rootId = null;
const MODES = ['full', 'close', 'ancestors'];
let mode = MODES.includes(localStorage.getItem('ft_mode')) ? localStorage.getItem('ft_mode') : 'full';
let selectedId = null;
let dirty = false, saveTimer = null;
const saves = new SaveCoordinator();
const view = { tx: 0, ty: 0, s: 1 };
let placedIds = new Set();
let lastLayout = null;

/* ---------------- utils ---------------- */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function lifeSpan(p) {
  const b = yearOf(p.birth_date), d = yearOf(p.death_date);
  const bu = p.birth_date_uncertain ? '~' : '', du = p.death_date_uncertain ? '~' : '';
  if (b && d) return `${bu}${b} – ${du}${d}`;
  if (b) return (p.deceased && !d) ? `${bu}${b} – †` : `${t('born')} ${bu}${b}`;
  if (d) return `${t('died')} ${du}${d}`;
  return p.deceased ? '†' : '';
}
/**
 * Compact age such as "82y 2m", "~82y" or "5m" (approximate ages are marked with ~);
 * `short` drops the months once the person is a year old.
 */
function ageLabel(age, short = false) {
  const label = age.months == null || (age.years && (short || age.months === 0)) ? t('ageY', { y: age.years })
    : age.years ? t('ageYM', { y: age.years, m: age.months })
    : t('ageM', { m: age.months });
  return (age.approx ? '~' : '') + label;
}
function snack(msg) {
  const sb = $('snackbar');
  sb.textContent = msg; sb.classList.remove('hidden');
  clearTimeout(sb._t); sb._t = setTimeout(() => sb.classList.add('hidden'), 2600);
}

/* ---------------- storage ---------------- */
async function refreshTrees() {
  trees = await store.list();
}

async function refreshSettings() {
  try { settings = store.getSettings ? await store.getSettings() : null; }
  catch { settings = null; }
}

function currentTreeName() {
  const td = trees.find(x => x.id === currentTreeId);
  if (td) return td.name;
  return (model && model.raw.summary && model.raw.summary.name) || '';
}

async function openTree(id) {
  const raw = await store.read(id);
  model = buildModel(raw);
  rootId = rootIdOf(model);
  focusId = rootId;
  selectedId = null;
  currentTreeId = id;
  clearTimeout(saveTimer);
  saves.reset();
  dirty = false;
  localStorage.setItem('ft_tree', id);
  updateTreeButton();
  applyLabels();
  renderTree();
  requestAnimationFrame(fitView);   // fit after layout/paint so the canvas has its real size
  renderPanel();
}

/* ---------------- serialize & save ---------------- */
function setStatus(cls, text) {
  const el = $('saveStatus');
  el.className = 'savestatus ' + cls;
  el.textContent = text;
}
function markDirty() {
  saves.markDirty();
  dirty = saves.dirty;
  setStatus('dirty', t('unsaved'));
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 1100);
}
async function saveNow() {
  clearTimeout(saveTimer);
  if (!model || !currentTreeId || !dirty) return true;
  const targetStore = store;
  const targetTreeId = currentTreeId;
  const payload = structuredClone(serialize(model));
  setStatus('dirty', t('saving'));
  const result = await saves.save(() => targetStore.write(targetTreeId, payload));
  dirty = saves.dirty;
  if (result.ok) {
    if (dirty) {
      setStatus('dirty', t('unsaved'));
      clearTimeout(saveTimer);
      saveTimer = setTimeout(saveNow, 1100);
    } else {
      const now = new Date();
      setStatus('saved', '✓ ' + t('saved') + ' ' + now.toTimeString().slice(0, 5));
    }
    const td = trees.find(x => x.id === targetTreeId);
    if (td) td.people = payload.people.length;
    return true;
  } else {
    setStatus('error', t('saveErr'));
    snack(t('saveErr') + ' — ' + result.error.message);
    return false;
  }
}
async function flushBeforeTransition() {
  return !dirty || await saveNow();
}
window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
// Flush a pending autosave when the tab is hidden or closing (best-effort;
// the beforeunload prompt above remains the backstop if the write can't finish).
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && dirty) saveNow();
});
window.addEventListener('pagehide', () => { if (dirty) saveNow(); });

/* ---------------- render ---------------- */
function renderTree() {
  const svg = $('lines'), cardsEl = $('cards');
  if (!model || !model.people.length) {
    $('canvasError').classList.add('hidden');
    svg.innerHTML = ''; cardsEl.replaceChildren();
    placedIds = new Set();
    $('printBtn').disabled = true;
    lastLayout = { cards: [], segs: [], bbox: { minX: 0, minY: 0, maxX: 1, maxY: 1 } };
    $('stats').textContent = '';
    $('focusChip').classList.add('hidden');
    renderEmptyState();
    return;
  }
  $('emptyState').classList.add('hidden');
  let output;
  try {
    output = layout(model, focusId, mode);
    $('canvasError').classList.add('hidden');
  } catch (error) {
    svg.innerHTML = ''; cardsEl.replaceChildren();
    placedIds = new Set();
    $('printBtn').disabled = true;
    lastLayout = { cards: [], segs: [], bbox: { minX: 0, minY: 0, maxX: 1, maxY: 1 } };
    $('stats').textContent = '';
    $('canvasError').textContent = t('layoutTooComplex');
    $('canvasError').classList.remove('hidden');
    return;
  }
  const { cards, segs, bbox } = output;
  placedIds = new Set(cards.map(c => c.id));
  $('printBtn').disabled = !placedIds.size;
  lastLayout = { cards, segs, bbox };

  const PAD = 60;
  const w = bbox.maxX - bbox.minX + PAD * 2, h = bbox.maxY - bbox.minY + PAD * 2;
  svg.setAttribute('viewBox', `${bbox.minX - PAD} ${bbox.minY - PAD} ${w} ${h}`);
  svg.style.left = (bbox.minX - PAD) + 'px';
  svg.style.top = (bbox.minY - PAD) + 'px';
  svg.style.width = w + 'px';
  svg.style.height = h + 'px';
  svg.innerHTML = `<path d="${segs.map(s => `M${s[0]} ${s[1]}L${s[2]} ${s[3]}`).join('')}"/>`;

  const frag = document.createDocumentFragment();
  for (const c of cards) {
    const p = model.byId.get(c.id);
    if (!p) continue;
    const div = document.createElement('div');
    const sexCls = p.sex === 'M' ? 'm' : p.sex === 'F' ? 'f' : 'u';
    const isSpine = p.lineage === 'direct_ancestor';
    const isRoot = p.id === rootId;
    div.className = `card ${sexCls}${isSpine ? ' spine' : ''}${isRoot ? ' root' : ''}${c.id === selectedId ? ' sel' : ''}`;
    div.style.left = c.x + 'px';
    div.style.top = c.y + 'px';
    div.dataset.id = c.id;
    div.title = t('dblFocus');
    div.tabIndex = 0;
    div.setAttribute('role', 'treeitem');
    div.setAttribute('aria-selected', c.id === selectedId ? 'true' : 'false');
    div.setAttribute('aria-label', t('cardHelp', { n: p.name }));
    const span = lifeSpan(p);
    const age = ageOf(p);
    const placeSrc = p.birth_place || p.birth_country || '';
    const place = ((p.birth_place_uncertain ? '~' : '') + placeSrc.split(',')[0].trim()).replace(/^~$/, '');
    const nick = (p.aliases || '').split(',')[0].trim();
    div.innerHTML =
      `<div class="cside"><div class="avatar">${esc((p.name || '?').trim().charAt(0).toLocaleUpperCase('tr'))}</div>` +
      (age ? `<div class="cage" title="${esc(ageLabel(age))}">${esc(ageLabel(age, true))}</div>` : '') + '</div>' +
      `<div class="cinfo"><div class="cname">${esc(p.name)}${p.deceased && !span.includes('†') && !yearOf(p.death_date) ? ' †' : ''}` +
      (nick ? ` <span class="cnick">“${esc(nick)}”</span>` : '') + '</div>' +
      (span ? `<div class="cdates">${esc(span)}</div>` : '') +
      (place ? `<div class="cplace">${esc(place)}</div>` : '') + '</div>' +
      (p.notes ? '<div class="notebadge">✎</div>' : '');
    frag.appendChild(div);
  }
  cardsEl.replaceChildren(frag);
  $('stats').textContent = `${model.people.length} ${t('people')} · ${placedIds.size} ${t('shown')}`;
  renderQuickAdd(cardsEl);

  const chip = $('focusChip');
  if (focusId && focusId !== rootId) {
    $('focusChipName').textContent = t('focusOn') + ': ' + (model.byId.get(focusId)?.name ?? '');
    chip.classList.remove('hidden');
  } else chip.classList.add('hidden');
}

/* On-canvas quick-add: the selected person's card grows "+" buttons — father /
 * mother above it (each only while that parent is missing, colored like the
 * card avatars), a spouse on the right edge (where marriage connectors run;
 * always offered, since multiple marriages are common in family history) and
 * a child below. Clicking one opens the add dialog for that relation;
 * setupCanvas routes the clicks. */
function renderQuickAdd(cardsEl) {
  if (!selectedId) return;
  const div = [...cardsEl.children].find(d => d.dataset.id === selectedId);
  const p = model.byId.get(selectedId);
  if (!div || !p) return;
  const btn = (rel, cls, label) =>
    `<button type="button" class="qadd ${cls}" data-addrel="${rel}" title="${esc(label)}" aria-label="${esc(label)}">+</button>`;
  const parents = [];
  if (!p._father && !p._unres.father) parents.push(['father', 'm', t('addFather')]);
  if (!p._mother && !p._unres.mother) parents.push(['mother', 'f', t('addMother')]);
  let html = parents.map(([rel, cls, label], i) =>
    btn(rel, `${cls} qa-top ${parents.length === 1 ? 'qa-center' : i === 0 ? 'qa-left' : 'qa-right'}`, label)).join('');
  html += btn('spouse', 's qa-side', t('addSpouse'));
  html += btn('child', 'c qa-bottom qa-center', t('addChild'));
  div.insertAdjacentHTML('beforeend', html);
}

function renderEmptyState() {
  const el = $('emptyState');
  if (model && model.people.length) { el.classList.add('hidden'); return; }
  const noTree = !model;
  $('emptyTitle').textContent = t(noTree ? 'emptyNoTreeTitle' : 'emptyNoPeopleTitle');
  $('emptyMsg').textContent = t(noTree ? 'emptyNoTreeMsg' : 'emptyNoPeopleMsg');
  const act = $('emptyAction');
  act.textContent = t(noTree ? 'emptyNoTreeAction' : 'emptyNoPeopleAction');
  act.onclick = noTree ? newTree : () => openAddDialog('standalone', null);
  el.classList.remove('hidden');
}

/* ---------------- view transform ---------------- */
function applyView() {
  $('world').style.transform = `translate(${view.tx}px, ${view.ty}px) scale(${view.s})`;
}
function fitView() {
  if (!lastLayout) return;
  const { bbox } = lastLayout;
  const cv = $('canvas');
  const cw = cv.clientWidth, ch = cv.clientHeight;
  const bw = bbox.maxX - bbox.minX + 120, bh = bbox.maxY - bbox.minY + 120;
  view.s = Math.min(cw / bw, ch / bh, 1.2);
  view.s = Math.max(view.s, 0.06);
  view.tx = (cw - (bbox.minX + bbox.maxX) * view.s) / 2;
  view.ty = (ch - (bbox.minY + bbox.maxY) * view.s) / 2;
  applyView();
}
function panToPerson(id) {
  if (!lastLayout) return;
  const c = lastLayout.cards.find(c => c.id === id);
  if (!c) return;
  const cv = $('canvas');
  if (view.s < 0.5) view.s = 0.8;
  view.tx = cv.clientWidth / 2 - (c.x + CARD_W / 2) * view.s;
  view.ty = cv.clientHeight / 2 - (c.y + CARD_H / 2) * view.s;
  applyView();
}
function zoomAt(factor, px, py) {
  const ns = Math.min(2.5, Math.max(0.06, view.s * factor));
  view.tx = px - (px - view.tx) * (ns / view.s);
  view.ty = py - (py - view.ty) * (ns / view.s);
  view.s = ns;
  applyView();
}

function setupCanvas() {
  const cv = $('canvas');
  // pressCard / pressQadd remember what the pointer went down on: once the
  // canvas captures the pointer, the eventual click event targets the canvas,
  // not the element under the finger/cursor.
  let panning = false, sx = 0, sy = 0, stx = 0, sty = 0, moved = false, pressCard = null, pressQadd = null;
  const onControl = e => e.target.closest('#focusChip, .zoomctrl, #fab, #emptyState');
  // Active pointers, so we can support one-finger pan and two-finger pinch-zoom.
  const pointers = new Map();
  let pinchDist = 0, pinchCx = 0, pinchCy = 0;
  const startPan = (x, y) => { panning = true; sx = x; sy = y; stx = view.tx; sty = view.ty; };
  cv.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (onControl(e)) { pressCard = null; return; }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    cv.setPointerCapture(e.pointerId);
    if (pointers.size === 1) {
      moved = false;
      pressCard = e.target.closest('.card');
      pressQadd = e.target.closest('.qadd');
      startPan(e.clientX, e.clientY);
      cv.classList.add('panning');
    } else if (pointers.size === 2) {
      // Two fingers down: switch to pinch; cancel pan/tap selection.
      panning = false; moved = true; pressCard = null; pressQadd = null;
      const [a, b] = [...pointers.values()];
      const rect = cv.getBoundingClientRect();
      pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      pinchCx = (a.x + b.x) / 2 - rect.left;
      pinchCy = (a.y + b.y) / 2 - rect.top;
    }
  });
  cv.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const rect = cv.getBoundingClientRect();
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const cx = (a.x + b.x) / 2 - rect.left, cy = (a.y + b.y) / 2 - rect.top;
      if (pinchDist > 0) {
        // Pan by midpoint travel, then zoom about the midpoint.
        view.tx += cx - pinchCx; view.ty += cy - pinchCy;
        zoomAt(dist / pinchDist, cx, cy);
      }
      pinchDist = dist; pinchCx = cx; pinchCy = cy;
      return;
    }
    if (!panning) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
    view.tx = stx + dx; view.ty = sty + dy;
    applyView();
  });
  const endPointer = e => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchDist = 0;
    if (pointers.size === 1) {
      // Lifted to a single finger: resume panning from the one that remains.
      const [p] = [...pointers.values()];
      startPan(p.x, p.y);
    } else if (pointers.size === 0) {
      panning = false;
      cv.classList.remove('panning');
    }
  };
  cv.addEventListener('pointerup', endPointer);
  cv.addEventListener('pointercancel', endPointer);
  cv.addEventListener('click', e => {
    if (onControl(e)) return;
    if (moved) { moved = false; return; }
    const qa = e.target.closest('.qadd') || pressQadd;
    if (qa) {
      pressQadd = null;
      const host = qa.closest('.card') || pressCard;
      if (host) openAddDialog(qa.dataset.addrel, host.dataset.id);
      return;
    }
    const card = e.target.closest('.card') || pressCard;
    if (card) selectPerson(card.dataset.id);
  });
  cv.addEventListener('dblclick', e => {
    if (onControl(e) || e.target.closest('.qadd') || pressQadd) return;
    const card = e.target.closest('.card') || pressCard;
    if (card) { setFocus(card.dataset.id); }
  });
  cv.addEventListener('keydown', e => {
    const card = e.target.closest('.card');
    if (!card || e.target.closest('.qadd') || !['Enter', ' '].includes(e.key)) return;
    e.preventDefault();
    if (e.key === 'Enter' && e.shiftKey) setFocus(card.dataset.id);
    else selectPerson(card.dataset.id, { focusCard: true });
  });
  cv.addEventListener('wheel', e => {
    e.preventDefault();
    const rect = cv.getBoundingClientRect();
    const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018));
    zoomAt(f, e.clientX - rect.left, e.clientY - rect.top);
  }, { passive: false });
  $('zoomIn').onclick = () => zoomAt(1.25, cv.clientWidth / 2, cv.clientHeight / 2);
  $('zoomOut').onclick = () => zoomAt(0.8, cv.clientWidth / 2, cv.clientHeight / 2);
  $('zoomFit').onclick = fitView;
}

/* ---------------- selection & panel ---------------- */
function selectPerson(id, opts = {}) {
  selectedId = id;
  renderTree();
  renderPanel();
  if (opts.pan && placedIds.has(id)) panToPerson(id);
  if (opts.focusCard) document.querySelector(`.card[data-id="${CSS.escape(id)}"]`)?.focus();
}
function setFocus(id) {
  focusId = id;
  renderTree();
  fitView();
  renderPanel();
}

function setDefaultPerson(id) {
  const p = model?.byId.get(id);
  if (!p || id === rootId || !setRootId(model, id)) return;
  rootId = id;
  markDirty();
  setFocus(id);
  snack(t('defaultSetSnack', { n: p.name }));
}

function fieldRow(key, label, p, ph) {
  const id = `pf-${key}`;
  return `<div class="field"><label for="${id}">${esc(label)}</label>` +
    `<input id="${id}" data-f="${key}" value="${esc(p[key] ?? '')}" placeholder="${esc(ph || '')}"></div>`;
}
function dateRow(key, label, p) {
  const unc = key + '_uncertain';
  const id = `pf-${key}`, uncId = `pf-${unc}`;
  return `<div class="field"><label for="${id}">${esc(label)}</label>` +
    `<label class="unclbl" for="${uncId}"><input id="${uncId}" type="checkbox" data-unc="${unc}" ${p[unc] ? 'checked' : ''}> ${esc(t('uncertain'))}</label>` +
    `<input id="${id}" data-f="${key}" data-date="1" value="${esc(p[key] ?? '')}" placeholder="YYYY.MM.DD"></div>`;
}
function placeRow(key, label, p) {
  const unc = key + '_uncertain';
  const id = `pf-${key}`, uncId = `pf-${unc}`;
  return `<div class="field"><label for="${id}">${esc(label)}</label>` +
    `<label class="unclbl" for="${uncId}"><input id="${uncId}" type="checkbox" data-unc="${unc}" ${p[unc] ? 'checked' : ''}> ${esc(t('uncertain'))}</label>` +
    `<input id="${id}" data-f="${key}" value="${esc(p[key] ?? '')}"></div>`;
}
function causeOptions(sel) {
  return `<option value="">${esc(t('notSet'))}</option>` +
    CAUSES.map(c => `<option value="${c}" ${sel === c ? 'selected' : ''}>${esc(t('cause_' + c))}</option>`).join('');
}

function renderPanel() {
  const panel = $('panel');
  if (!model || !selectedId || !model.byId.has(selectedId)) {
    panel.classList.add('hidden');
    panel.innerHTML = '';
    return;
  }
  const p = model.byId.get(selectedId);
  const nameOf = id => model.byId.get(id)?.name || '?';
  const chip = (id, extra) => `<button class="chip${extra || ''}" data-go="${esc(id)}">${esc(nameOf(id))}</button>`;
  // a chip with a remove-link button; rel is this person's relation to p
  const linked = (id, rel) => {
    const label = esc(t('unlinkLabel', { n: nameOf(id) }));
    return `<span class="chipgrp">${chip(id)}<button class="chipx" data-unlink="${rel}" data-id="${esc(id)}" title="${label}" aria-label="${label}">✕</button></span>`;
  };
  const ghost = n => `<span class="chip ghost" title="?">${esc(n)}</span>`;

  let badge = '';
  if (p.id === rootId) badge = `<span class="badge root">${t('rootBadge')}</span>`;
  else if (p.lineage === 'direct_ancestor') badge = `<span class="badge anc">${t('ancBadge')}</span>`;

  const fatherHtml = p._father ? linked(p._father, 'parent')
    : (p._unres.father ? ghost(p._unres.father)
      : `<button class="chip addchip" data-add="father">+ ${t('addFather')}</button>`);
  const motherHtml = p._mother ? linked(p._mother, 'parent')
    : (p._unres.mother ? ghost(p._unres.mother)
      : `<button class="chip addchip" data-add="mother">+ ${t('addMother')}</button>`);
  const siblingHtml = [...siblingIds(model, p).map(id => chip(id)),
    `<button class="chip addchip" data-add="sibling">+ ${t('addSibling')}</button>`].join('');
  const spouseHtml = [...p._spouses.map(id => linked(id, 'spouse')), ...p._unres.spouses.map(ghost),
    `<button class="chip addchip" data-add="spouse">+ ${t('addSpouse')}</button>`].join('');
  const childHtml = [...birthSortIds(model, p._children).map(id => linked(id, 'child')), ...p._unres.children.map(ghost),
    `<button class="chip addchip" data-add="child">+ ${t('addChild')}</button>`].join('');

  panel.innerHTML = `
    <div class="panel-head">
      <h2 id="panelName">${esc(p.name)}</h2>
      <button class="iconbtn" id="panelClose" title="${t('closePanel')}" aria-label="${t('closePanel')}">✕</button>
    </div>
    ${badge}
    ${placedIds.has(p.id) ? '' : `<div class="notvisible">${t('notInTree')}</div>`}
    ${fieldRow('name', t('name'), p)}
    ${fieldRow('aliases', t('aliases'), p)}
    ${p.sex === 'F' ? fieldRow('maiden_name', t('maidenName'), p) : ''}
    <div class="field"><label>${t('sex')}</label>
      <div class="segmini" role="group" aria-label="${t('sex')}">
        <button type="button" data-sexval="M" aria-pressed="${p.sex === 'M'}" class="${p.sex === 'M' ? 'active' : ''}">${t('male')}</button>
        <button type="button" data-sexval="F" aria-pressed="${p.sex === 'F'}" class="${p.sex === 'F' ? 'active' : ''}">${t('female')}</button>
      </div>
    </div>
    ${dateRow('birth_date', t('birthDate'), p)}
    <div class="row2">
      ${placeRow('birth_place', t('birthPlace'), p)}
      ${fieldRow('birth_country', t('birthCountry'), p)}
    </div>
    ${dateRow('death_date', t('deathDate'), p)}
    <div class="row2">
      ${placeRow('death_place', t('deathPlace'), p)}
      ${fieldRow('death_country', t('deathCountry'), p)}
    </div>
    <div class="agerow" id="pAge"></div>
    <label class="checkrow"><input type="checkbox" id="pDeceased" ${p.deceased ? 'checked' : ''}> ${t('deceased')}</label>
    ${p.deceased ? `<div class="row2">
      <div class="field"><label for="pf-death_cause">${t('deathCause')}</label>
        <select id="pf-death_cause" data-f="death_cause">${causeOptions(p.death_cause)}</select></div>
      <div class="field"><label for="pf-death_cause_detail">${t('deathCauseDetail')}</label>
        <input id="pf-death_cause_detail" data-f="death_cause_detail" value="${esc(p.death_cause_detail ?? '')}"></div>
    </div>` : ''}
    <label class="checkrow"><input type="checkbox" id="pIlleg" ${p.had_illegitimate_children ? 'checked' : ''}> ${t('illegit')}</label>
    <div class="row2">
      ${fieldRow('burial_place', t('burialPlace'), p)}
      ${fieldRow('occupation', t('occupation'), p)}
    </div>
    <div class="field"><label for="pf-notes">${t('notes')}</label>
      <textarea id="pf-notes" data-f="notes" placeholder="${esc(t('notesPh'))}">${esc(p.notes ?? '')}</textarea>
    </div>
    <div class="relsec">
      <h3>${t('father')}</h3><div class="chips">${fatherHtml}</div>
      <h3>${t('mother')}</h3><div class="chips">${motherHtml}</div>
      <h3>${t('siblings')}</h3><div class="chips">${siblingHtml}</div>
      <h3>${t('spouses')}</h3><div class="chips">${spouseHtml}</div>
      <h3>${t('children')}</h3><div class="chips">${childHtml}</div>
    </div>
    <div class="panel-actions">
      <button class="btn tonal" id="pFocus">⌖ ${t('focusHere')}</button>
      ${p.id !== rootId ? `<button class="btn tonal icon-label" id="pMakeDefault">${DEFAULT_SVG}${t('setDefault')}</button>` : ''}
      <button class="btn danger" id="pDelete">${t('del')}</button>
    </div>`;

  panel.classList.remove('hidden');
  panel.setAttribute('aria-labelledby', 'panelName');

  $('panelClose').onclick = () => { selectedId = null; renderTree(); renderPanel(); };
  $('pFocus').onclick = () => setFocus(p.id);
  if ($('pMakeDefault')) $('pMakeDefault').onclick = () => setDefaultPerson(p.id);
  $('pDelete').onclick = () => confirmDelete(p.id);
  const showAge = () => {
    const age = ageOf(p);
    $('pAge').textContent = age ? `${t(p.death_date ? 'ageAtDeath' : 'age')}: ${ageLabel(age)}` : '';
    $('pAge').classList.toggle('hidden', !age);
  };
  showAge();
  $('pDeceased').onchange = e => { p.deceased = e.target.checked; touch(p); markDirty(); renderPanel(); renderTree(); };
  $('pIlleg').onchange = e => {
    if (e.target.checked) p.had_illegitimate_children = true; else delete p.had_illegitimate_children;
    touch(p); markDirty();
  };

  panel.querySelectorAll('[data-f]:not([data-date])').forEach(inp => {
    inp.addEventListener('input', () => { p[inp.dataset.f] = inp.value; touch(p); markDirty(); });
    inp.addEventListener('change', () => renderTree());
  });
  panel.querySelectorAll('input[data-date]').forEach(inp => {
    const validate = () => {
      const v = inp.value.trim();
      inp.classList.toggle('invalid', !(v === '' || DATE_RE.test(v)));
    };
    validate();
    inp.addEventListener('input', () => { p[inp.dataset.f] = inp.value.trim(); touch(p); markDirty(); validate(); });
    inp.addEventListener('change', () => {
      const v = inp.value.trim().replace(/[-/\s]+/g, '.');
      inp.value = v; p[inp.dataset.f] = v;
      validate(); touch(p); markDirty(); renderTree(); showAge();
      if (inp.dataset.f === 'death_date' && v && !p.deceased) { p.deceased = true; renderPanel(); }
    });
  });
  panel.querySelectorAll('[data-unc]').forEach(cb => {
    cb.onchange = () => {
      if (cb.checked) p[cb.dataset.unc] = true; else delete p[cb.dataset.unc];
      touch(p); markDirty(); renderTree(); showAge();
    };
  });
  panel.querySelectorAll('[data-sexval]').forEach(btn => {
    btn.onclick = () => { p.sex = btn.dataset.sexval; touch(p); markDirty(); renderPanel(); renderTree(); };
  });
  panel.querySelectorAll('[data-go]').forEach(btn => {
    btn.onclick = () => selectPerson(btn.dataset.go, { pan: true });
  });
  panel.querySelectorAll('[data-add]').forEach(btn => {
    btn.onclick = () => openAddDialog(btn.dataset.add, p.id);
  });
  panel.querySelectorAll('[data-unlink]').forEach(btn => {
    btn.onclick = () => confirmUnlink(p.id, btn.dataset.id, btn.dataset.unlink);
  });
}
function touch(p) { p.updated_at = new Date().toISOString(); }

/* ---------------- add person dialog ---------------- */
const addState = { relation: null, anchorId: null, existingId: null, sex: 'M' };

function genId() {
  let i = model.people.length + 1;
  while (model.byId.has('p' + i)) i++;
  return 'p' + i;
}

function openAddDialog(relation, anchorId) {
  if (!model) return;
  addState.relation = relation;
  addState.anchorId = anchorId || null;
  addState.existingId = null;
  const anchor = anchorId ? model.byId.get(anchorId) : null;
  // Sensible default sex (always changeable in the dialog): mothers F,
  // spouses default to the opposite of the anchor's sex when it is known.
  addState.sex = relation === 'mother' ? 'F'
    : relation === 'spouse' && anchor && anchor.sex === 'M' ? 'F'
    : 'M';

  $('adTitle').textContent = t('addPerson');
  const relKey = { child: 'relChild', spouse: 'relSpouse', father: 'relFather', mother: 'relMother', sibling: 'relSibling' }[relation];
  $('adRel').textContent = relKey && anchor ? t(relKey, { n: anchor.name }) : t('relNone');

  $('lbName').textContent = t('name');
  $('lbAlias').textContent = t('aliases');
  $('lbMaiden').textContent = t('maidenName');
  $('lbCause').textContent = t('deathCause');
  $('lbCauseD').textContent = t('deathCauseDetail');
  $('apCause').innerHTML = causeOptions('');
  $('lbSex').textContent = t('sex');
  $('sexM').textContent = t('male');
  $('sexF').textContent = t('female');
  $('lbBd').textContent = t('birthDate');
  $('lbBp').textContent = t('birthPlace');
  $('lbDd').textContent = t('deathDate');
  $('lbDp').textContent = t('deathPlace');
  $('lbBc').textContent = t('birthCountry');
  $('lbDc').textContent = t('deathCountry');
  $('lbDec').textContent = t('deceased');
  $('lbBur').textContent = t('burialPlace');
  $('lbOcc').textContent = t('occupation');
  $('lbNotes').textContent = t('notes');
  document.querySelectorAll('#addDialog .unctxt').forEach(e => { e.textContent = t('uncertain'); });
  $('apCancel').textContent = t('cancel');
  $('apOk').textContent = t('add');
  $('apHint').textContent = (relation && relation !== 'standalone') ? t('existingHint') : '';

  for (const id of ['apName', 'apAlias', 'apMaiden', 'apBd', 'apBp', 'apBc', 'apDd', 'apDp', 'apDc', 'apCauseD', 'apBur', 'apOcc', 'apNotes']) $(id).value = '';
  for (const id of ['apBdU', 'apBpUnc', 'apDdU', 'apDpUnc', 'apDec']) $(id).checked = false;
  $('apChosen').classList.add('hidden');
  $('apSug').classList.add('hidden');
  $('apDetails').classList.remove('hidden');
  updateSexButtons();

  const fOther = $('fOther');
  if (relation === 'child' && anchor && anchor._spouses.length) {
    $('lbOther').textContent = t('otherParent');
    const sel = $('apOther');
    sel.innerHTML = `<option value="">${t('nonePar')}</option>` +
      anchor._spouses.map(id => `<option value="${esc(id)}">${esc(model.byId.get(id)?.name || '?')}</option>`).join('');
    sel.value = anchor._spouses.length === 1 ? anchor._spouses[0] : '';
    fOther.classList.remove('hidden');
  } else fOther.classList.add('hidden');

  $('fSex').style.display = (relation === 'father' || relation === 'mother') ? 'none' : '';

  $('addDialog').showModal();
  $('apName').focus();
}
function updateSexButtons() {
  $('sexM').className = addState.sex === 'M' ? 'active' : '';
  $('sexF').className = addState.sex === 'F' ? 'active' : '';
  $('sexM').setAttribute('aria-pressed', String(addState.sex === 'M'));
  $('sexF').setAttribute('aria-pressed', String(addState.sex === 'F'));
}

function setupAddDialog() {
  $('sexM').onclick = () => { addState.sex = 'M'; updateSexButtons(); };
  $('sexF').onclick = () => { addState.sex = 'F'; updateSexButtons(); };
  $('apCancel').onclick = () => $('addDialog').close();
  $('apClear').onclick = () => {
    addState.existingId = null;
    $('apChosen').classList.add('hidden');
    $('apDetails').classList.remove('hidden');
    $('apOk').textContent = t('add');
    $('apName').value = '';
    $('apName').focus();
  };
  $('apName').addEventListener('input', () => {
    const q = norm($('apName').value.trim());
    const box = $('apSug');
    if (q.length < 2 || !addState.relation || addState.relation === 'standalone') { box.classList.add('hidden'); return; }
    const hits = model.people
      .filter(p => p.id !== addState.anchorId && searchText(p).includes(q))
      .slice(0, 8);
    if (!hits.length) { box.classList.add('hidden'); return; }
    box.innerHTML = hits.map(p =>
      `<button type="button" class="item" role="option" data-pick="${esc(p.id)}"><span>${esc(p.name)}</span><span class="meta">${esc(lifeSpan(p))}</span></button>`).join('');
    box.classList.remove('hidden');
    box.querySelectorAll('[data-pick]').forEach(it => {
      it.onmousedown = e => {
        e.preventDefault();
        addState.existingId = it.dataset.pick;
        $('apChosen').querySelector('span').textContent = model.byId.get(addState.existingId).name;
        $('apChosen').classList.remove('hidden');
        $('apDetails').classList.add('hidden');
        $('apOk').textContent = t('link');
        box.classList.add('hidden');
      };
    });
  });
  $('apName').addEventListener('blur', () => setTimeout(() => $('apSug').classList.add('hidden'), 120));
  $('apName').addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('apSug').classList.contains('hidden')) {
      e.preventDefault(); e.stopPropagation();
      $('apSug').classList.add('hidden');
    }
  });
  $('addDialog').addEventListener('pointerdown', e => {
    if (!e.target.closest('.namewrap')) $('apSug').classList.add('hidden');
  });
  $('apOk').onclick = commitAdd;
  $('addDialog').addEventListener('close', () => $('apSug').classList.add('hidden'));
}

function commitAdd() {
  const { relation, anchorId, existingId } = addState;
  const anchor = anchorId ? model.byId.get(anchorId) : null;
  let person;
  if (existingId) {
    person = model.byId.get(existingId);
  } else {
    const name = $('apName').value.trim();
    if (!name) { $('apName').focus(); return; }
    person = {
      id: genId(), name, sex: addState.sex,
      _father: null, _mother: null, _spouses: [], _children: [], _siblings: [],
      _unres: {
        father: null, mother: null, spouses: [], children: [], siblings: [],
        fatherId: null, motherId: null, spouseIds: [], childIds: [], siblingIds: []
      }
    };
    const val = id => $(id).value.trim();
    const dval = id => val(id).replace(/[-/\s]+/g, '.');
    if (val('apAlias')) person.aliases = val('apAlias');
    if (val('apMaiden')) person.maiden_name = val('apMaiden');
    if (val('apBd')) person.birth_date = dval('apBd');
    if ($('apBdU').checked) person.birth_date_uncertain = true;
    if (val('apBp')) person.birth_place = val('apBp');
    if ($('apBpUnc').checked) person.birth_place_uncertain = true;
    if (val('apBc')) person.birth_country = val('apBc');
    if (val('apDc')) person.death_country = val('apDc');
    if (val('apDd')) person.death_date = dval('apDd');
    if ($('apDdU').checked) person.death_date_uncertain = true;
    if (val('apDp')) person.death_place = val('apDp');
    if ($('apDpUnc').checked) person.death_place_uncertain = true;
    if ($('apCause').value) person.death_cause = $('apCause').value;
    if (val('apCauseD')) person.death_cause_detail = val('apCauseD');
    if ($('apDec').checked || val('apDd') || $('apCause').value) person.deceased = true;
    if (val('apBur')) person.burial_place = val('apBur');
    if (val('apOcc')) person.occupation = val('apOcc');
    if (val('apNotes')) person.notes = val('apNotes');
    model.people.push(person);
    model.byId.set(person.id, person);
  }
  const newPerson = !existingId;
  const parentLinks = [], siblingLinks = [];
  if (anchor && relation === 'child') {
    const anchorSlot = anchor.sex === 'F' ? '_mother' : '_father';
    parentLinks.push({ childId: person.id, parentId: anchor.id, slot: anchorSlot });
    const otherId = $('fOther').classList.contains('hidden') ? '' : $('apOther').value;
    if (otherId && model.byId.has(otherId)) {
      parentLinks.push({ childId: person.id, parentId: otherId, slot: anchorSlot === '_mother' ? '_father' : '_mother' });
    }
  } else if (anchor && (relation === 'father' || relation === 'mother')) {
    if (!existingId) person.sex = relation === 'father' ? 'M' : 'F';
    const slot = relation === 'father' ? '_father' : '_mother';
    parentLinks.push({ childId: anchor.id, parentId: person.id, slot });
    // explicit siblings were linked because their parents were unknown, so the
    // new parent is theirs too, unless they already have one in that role
    for (const id of anchor._siblings) {
      const sibling = model.byId.get(id);
      if (sibling && !sibling[slot] && id !== person.id) parentLinks.push({ childId: id, parentId: person.id, slot });
    }
  } else if (anchor && relation === 'sibling') {
    // share the anchor's known parents, but never replace a parent the person already has
    let sharesParent = false;
    for (const slot of ['_father', '_mother']) {
      if (!anchor[slot]) continue;
      if (!person[slot]) parentLinks.push({ childId: person.id, parentId: anchor[slot], slot });
      if (!person[slot] || person[slot] === anchor[slot]) sharesParent = true;
    }
    // no shared parent to derive the link from: record it explicitly, joining
    // the anchor's explicit sibling group so the siblings stay connected
    if (!sharesParent) {
      for (const id of [anchor.id, ...anchor._siblings]) if (id !== person.id) siblingLinks.push(id);
    }
  }
  try {
    parentLinks.forEach(link => assertCanSetParent(model, link.childId, link.parentId, link.slot));
    siblingLinks.forEach(id => assertCanLinkSiblings(model, person.id, id));
    const touched = new Set([person, anchor].filter(Boolean));
    for (const link of parentLinks) {
      const changed = setParent(model, link.childId, link.parentId, link.slot);
      for (const value of [changed.child, changed.parent, changed.previous]) if (value) touched.add(value);
    }
    if (anchor && relation === 'spouse') {
      const linked = linkSpouses(model, anchor.id, person.id);
      touched.add(linked.first); touched.add(linked.second);
    }
    for (const id of siblingLinks) {
      const linked = linkSiblings(model, person.id, id);
      touched.add(linked.first); touched.add(linked.second);
    }
    touched.forEach(touch);
  } catch (error) {
    if (newPerson) {
      model.people = model.people.filter(candidate => candidate.id !== person.id);
      model.byId.delete(person.id);
    }
    snack(t(error.code === 'ECYCLE' ? 'relationshipCycle' : 'relationshipInvalid'));
    return;
  }
  // first person in a fresh tree becomes the root/focus so the layout has somewhere to start
  if (!rootId || !model.byId.has(rootId)) rootId = rootIdOf(model);
  if (!focusId || !model.byId.has(focusId)) focusId = rootId;
  const wasFirst = model.people.length === 1;
  markDirty();
  $('addDialog').close();
  renderTree();
  if (wasFirst) requestAnimationFrame(fitView);
  selectPerson(person.id, { pan: !wasFirst });
  snack(t(existingId ? 'linkedSnack' : 'addedSnack', { n: person.name }));
}

/* ---------------- delete person ---------------- */
function confirmDelete(id) {
  const p = model.byId.get(id);
  const msgKey = storeMode === 'idb' ? 'confirmDelMsgBrowser' : 'confirmDelMsg';
  askConfirm(t('confirmDelTitle'), t(msgKey, { n: p.name }), t('del')).then(ok => {
    if (ok) deletePerson(id);
  });
}
/* Remove one relationship link (both people stay); rel is otherId's relation to id. */
function confirmUnlink(id, otherId, rel) {
  const a = model.byId.get(id), b = model.byId.get(otherId);
  if (!a || !b) return;
  askConfirm(t('unlinkTitle'), t('unlinkMsg', { a: a.name, b: b.name }), t('unlinkOk')).then(ok => {
    if (!ok || !model.byId.has(id) || !model.byId.has(otherId)) return;
    const changed = rel === 'spouse' ? unlinkSpouses(model, id, otherId)
      : rel === 'parent' ? unlinkParentChild(model, otherId, id)
      : unlinkParentChild(model, id, otherId);
    Object.values(changed).forEach(touch);
    markDirty();
    renderTree();
    renderPanel();
    snack(t('unlinkedSnack', { a: a.name, b: b.name }));
  });
}
function deletePerson(id) {
  const p = model.byId.get(id);
  if (!p) return;
  for (const q of model.people) {
    if (q._father === id) q._father = null;
    if (q._mother === id) q._mother = null;
    q._spouses = q._spouses.filter(s => s !== id);
    q._children = q._children.filter(c => c !== id);
    q._siblings = q._siblings.filter(s => s !== id);
  }
  model.people = model.people.filter(q => q.id !== id);
  model.byId.delete(id);
  rootId = rootIdOf(model);
  if (!focusId || !model.byId.has(focusId)) focusId = rootId;
  if (selectedId === id) selectedId = null;
  markDirty();
  renderTree();
  renderPanel();
  snack(t('deletedSnack', { n: p.name }));
}

/* ---------------- dialogs (prompt / confirm) ---------------- */
function askPrompt(title, value = '', okLabel) {
  return new Promise(resolve => {
    const dlg = $('promptDialog');
    let settled = false;
    const finish = v => { if (settled) return; settled = true; resolve(v); };
    $('pdTitle').textContent = title;
    $('pdInput').value = value;
    $('pdCancel').textContent = t('cancel');
    $('pdOk').textContent = okLabel || t('ok');
    $('pdOk').onclick = () => { const v = $('pdInput').value.trim(); if (v) { dlg.close(); finish(v); } else $('pdInput').focus(); };
    $('pdCancel').onclick = () => { dlg.close(); finish(null); };
    $('pdInput').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); $('pdOk').click(); } };
    dlg.addEventListener('close', () => finish(null), { once: true });
    dlg.showModal();
    $('pdInput').focus(); $('pdInput').select();
  });
}
function askConfirm(title, msg, okLabel) {
  return new Promise(resolve => {
    const dlg = $('confirmDialog');
    let settled = false;
    const finish = v => { if (settled) return; settled = true; resolve(v); };
    $('cdTitle').textContent = title;
    $('cdMsg').textContent = msg;
    $('cdCancel').textContent = t('cancel');
    $('cdOk').textContent = okLabel || t('del');
    $('cdOk').onclick = () => { dlg.close(); finish(true); };
    $('cdCancel').onclick = () => { dlg.close(); finish(false); };
    dlg.addEventListener('close', () => finish(false), { once: true });
    dlg.showModal();
  });
}

/* ---------------- welcome / onboarding ---------------- */
const WELCOME_KEY = 'ft_welcomed';
const LOCAL_CMD = 'npx genograph';

function welcomeHTML() {
  // The "run it purely locally" tip only makes sense in the hosted browser build;
  // in the local Node app (server mode) the user is already running it locally.
  const localBlock = storeMode === 'server' ? '' : `
    <div class="welcome-local">
      <h3>${esc(t('welcomeLocalTitle'))}</h3>
      <p>${esc(t('welcomeLocal'))}</p>
      <div class="welcome-cmd">
        <code>${esc(LOCAL_CMD)}</code>
        <button type="button" class="welcome-copy" id="welcomeCopy">${esc(t('welcomeCopy'))}</button>
      </div>
    </div>`;
  const step = (ico, title, body) =>
    `<li class="welcome-step"><span class="ico">${ico}</span>` +
    `<span class="txt"><b>${esc(title)}</b> <span>${esc(body)}</span></span></li>`;
  return `
    <div class="welcome-hero">
      <div class="welcome-logo">${BRAND_SVG}</div>
      <h2>${esc(t('welcomeTitle'))}</h2>
      <p class="welcome-intro">${esc(t('welcomeIntro'))}</p>
    </div>
    <div class="welcome-exploring">${esc(t('welcomeExploring'))}</div>
    <ul class="welcome-steps">
      ${step(W_EDIT_SVG, t('welcomeUse1Title'), t('welcomeUse1'))}
      ${step(W_ADD_SVG, t('welcomeUse2Title'), t('welcomeUse2'))}
      ${step(W_TREE_SVG, t('welcomeUse3Title'), t('welcomeUse3'))}
    </ul>
    <p class="welcome-tips">${esc(t('welcomeTips'))}</p>
    <div class="welcome-note">${W_SHIELD_SVG}<span>${esc(t('welcomePrivacy'))}</span></div>
    ${localBlock}
    <div class="welcome-actions">
      <button class="btn filled" id="welcomeOk" type="button">${esc(t('welcomeStart'))}</button>
    </div>`;
}

function openWelcome() {
  const dlg = $('welcomeDialog');
  $('welcomeBody').innerHTML = welcomeHTML();
  $('welcomeClose').title = t('closePanel');
  $('welcomeOk').onclick = () => dlg.close();
  const copy = $('welcomeCopy');
  if (copy) copy.onclick = async () => {
    try {
      await navigator.clipboard.writeText(LOCAL_CMD);
      copy.textContent = t('welcomeCopied');
      setTimeout(() => { copy.textContent = t('welcomeCopy'); }, 1600);
    } catch { snack(LOCAL_CMD); }   // clipboard blocked — surface the command instead
  };
  dlg.showModal();
}

/** Show the welcome once, on the very first visit (per browser/profile). */
function maybeWelcome() {
  if (localStorage.getItem(WELCOME_KEY)) return;
  localStorage.setItem(WELCOME_KEY, '1');
  openWelcome();
}

function setupWelcome() {
  $('helpBtn').onclick = openWelcome;
  $('welcomeClose').onclick = () => $('welcomeDialog').close();
  // click on the backdrop (outside the card) closes it
  $('welcomeDialog').addEventListener('click', e => {
    if (e.target === $('welcomeDialog')) $('welcomeDialog').close();
  });
}

/* ---------------- tree library ---------------- */
function updateTreeButton() {
  $('treeBtnName').textContent = currentTreeName() || t('newTree');
}
function openTreeMenu() {
  renderTreeMenu();
  $('treeMenu').classList.remove('hidden');
  $('treeBtn').setAttribute('aria-expanded', 'true');
}
function closeTreeMenu() {
  $('treeMenu').classList.add('hidden');
  $('treeBtn').setAttribute('aria-expanded', 'false');
}
function renderTreeMenu() {
  $('tmLabel').textContent = currentTreeName();
  const hasCurrent = !!currentTreeId;
  for (const id of ['tmRename', 'tmDuplicate', 'tmExport', 'tmDelete']) $(id).disabled = !hasCurrent;
  const list = $('tmList');
  if (!trees.length) {
    list.innerHTML = `<div class="tm-empty">${esc(t('emptyNoTreeMsg'))}</div>`;
    return;
  }
  list.innerHTML = trees.map(td =>
    `<button class="tm-item${td.id === currentTreeId ? ' active' : ''}" data-tree="${esc(td.id)}">` +
    `<span class="tm-name">${esc(td.name)}</span><span class="tm-count">${td.people}</span></button>`).join('');
  list.querySelectorAll('[data-tree]').forEach(b => b.onclick = () => {
    closeTreeMenu();
    if (b.dataset.tree !== currentTreeId) switchTree(b.dataset.tree);
  });
}
async function switchTree(id) {
  if (!await flushBeforeTransition()) return;
  try { await openTree(id); } catch (e) { snack(t('loadError') + ': ' + e.message); }
}
async function newTree() {
  closeTreeMenu();
  if (!await flushBeforeTransition()) return;
  const name = await askPrompt(t('newTreeTitle'), '', t('add'));
  if (!name) return;
  try {
    const out = await store.create(name);
    await refreshTrees();
    await openTree(out.id);
    snack(t('treeCreated', { n: out.name }));
  } catch (e) { snack(t('importFailed') + ': ' + e.message); }
}
async function renameCurrent() {
  closeTreeMenu();
  if (!currentTreeId) return;
  const name = await askPrompt(t('renameTreeTitle'), currentTreeName(), t('add'));
  if (!name) return;
  try {
    const out = await store.rename(currentTreeId, name);
    if (model) { model.raw.summary = model.raw.summary || {}; model.raw.summary.name = out.name; }
    await refreshTrees();
    updateTreeButton();
    snack(t('treeRenamed'));
  } catch (e) { snack(e.message); }
}
async function duplicateCurrent() {
  closeTreeMenu();
  if (!currentTreeId) return;
  if (!await flushBeforeTransition()) return;
  try {
    const out = await store.duplicate(currentTreeId);
    await refreshTrees();
    await openTree(out.id);
    snack(t('treeCreated', { n: out.name }));
  } catch (e) { snack(e.message); }
}
async function deleteCurrent() {
  closeTreeMenu();
  if (!currentTreeId) return;
  const nm = currentTreeName();
  const msgKey = storeMode === 'idb' ? 'confirmDelTreeMsgBrowser' : 'confirmDelTreeMsg';
  const ok = await askConfirm(t('confirmDelTreeTitle'), t(msgKey, { n: nm }), t('del'));
  if (!ok) return;
  try {
    const deletedId = currentTreeId;
    await store.delete(deletedId);
    await refreshTrees();
    snack(t('treeDeleted', { n: nm }));
    const next = trees.find(td => td.id !== deletedId) || trees[0];
    if (next) await openTree(next.id);
    else resetToEmpty();
  } catch (e) { snack(e.message); }
}
/** Clear the workspace when no tree is open (after deleting the last one, or an empty store). */
function resetToEmpty() {
  model = null; currentTreeId = null; rootId = null; focusId = null; selectedId = null;
  clearTimeout(saveTimer); saves.reset(); dirty = false;
  localStorage.removeItem('ft_tree');
  updateTreeButton(); renderTree(); renderPanel();
}
function exportCurrent() {
  closeTreeMenu();
  if (!model) return;
  const data = serialize(model);
  const blob = new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = (currentTreeId || 'tree') + '.json';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function importTreeFile(file) {
  if (!file) return;
  if (!await flushBeforeTransition()) return;
  try {
    if (file.size > TREE_LIMITS.maxCharacters) throw new Error('File is larger than 25 MB.');
    const data = JSON.parse(await file.text());
    validateTree(data);
    const name = (data.summary && data.summary.name) || file.name.replace(/\.json$/i, '');
    const out = await store.importTree(name, data);
    await refreshTrees();
    await openTree(out.id);
    snack(t('treeImported', { n: out.name }));
  } catch (e) {
    snack(t('importFailed') + ': ' + e.message);
  }
}
function setupTreeLibrary() {
  $('treeBtn').onclick = () => ($('treeMenu').classList.contains('hidden') ? openTreeMenu() : closeTreeMenu());
  $('tmNew').onclick = newTree;
  $('tmImport').onclick = () => { closeTreeMenu(); $('importFile').value = ''; $('importFile').click(); };
  $('importFile').onchange = e => { importTreeFile(e.target.files[0]); };
  $('tmRename').onclick = renameCurrent;
  $('tmDuplicate').onclick = duplicateCurrent;
  $('tmExport').onclick = exportCurrent;
  $('tmDelete').onclick = deleteCurrent;
  document.addEventListener('click', e => { if (!e.target.closest('.treewrap')) closeTreeMenu(); });
}

/* ---------------- print ----------------
 * The current view is rendered into #printView, which only print media shows,
 * and the browser's own print dialog handles paper and "Save as PDF". */
const printOpts = { notes: true, hideLiving: false, compact: false };
const MODE_LABEL = { full: 'modeFull', close: 'modeClose', ancestors: 'modeAnc' };

const canPrint = () => !!(model && lastLayout?.cards.length);
function renderPrintView() {
  $('printView').innerHTML = viewReport(model, lastLayout.cards, focusId, {
    t, lang, title: currentTreeName(), note: model.raw.summary?.note, view: t(MODE_LABEL[mode]),
    notes: printOpts.notes, hideLiving: printOpts.hideLiving, compact: printOpts.compact,
    ahnentafel: mode === 'ancestors'
  });
}
// notes only fit the detailed layout
function syncNotesRow() {
  $('prNotesRow').classList.toggle('hidden', $('prCompact').checked);
}
function openPrintDialog() {
  const dlg = $('printDialog');
  if (!canPrint() || dlg.open) return;
  $('prTitle').textContent = t('printTitle');
  $('prViewHint').textContent = t('printViewHint', {
    v: t(MODE_LABEL[mode]), n: model.byId.get(focusId)?.name || '?', c: placedIds.size
  });
  $('lbPrLayout').textContent = t('printLayout');
  $('lbPrDetailed').textContent = t('printDetailed');
  $('prDetailedHint').textContent = t('printDetailedHint');
  $('lbPrCompact').textContent = t('printCompact');
  $('prCompactHint').textContent = t('printCompactHint');
  $('lbPrNotes').textContent = t('printNotes');
  $('lbPrLiving').textContent = t('printHideLiving');
  $('prPdfHint').textContent = t('printPdfHint');
  $('prCancel').textContent = t('cancel');
  $('prOk').textContent = t('printBtn');
  $(printOpts.compact ? 'prCompact' : 'prDetailed').checked = true;
  $('prNotes').checked = printOpts.notes;
  syncNotesRow();
  $('prLiving').checked = printOpts.hideLiving;
  dlg.showModal();
  $('prOk').focus();
}
function printNow() {
  printOpts.compact = $('prCompact').checked;
  printOpts.notes = $('prNotes').checked;
  printOpts.hideLiving = $('prLiving').checked;
  $('printDialog').close();
  renderPrintView();
  window.print();
}
function setupPrint() {
  $('printBtn').onclick = openPrintDialog;
  $('prCancel').onclick = () => $('printDialog').close();
  $('prOk').onclick = printNow;
  // the compact table has no room for notes
  $('prDetailed').onchange = $('prCompact').onchange = syncNotesRow;
  // Ctrl/Cmd+P opens the print options instead of printing the canvas
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'p' && canPrint()) {
      e.preventDefault();
      openPrintDialog();
    }
  });
  // printing from the browser menu prints the current view with the last options
  window.addEventListener('beforeprint', () => {
    if (canPrint() && !$('printView').childElementCount) renderPrintView();
  });
  window.addEventListener('afterprint', () => $('printView').replaceChildren());
}

/* ---------------- data folder ---------------- */
function updateDataRow() {
  const dir = settings && settings.dataDir;
  $('tmDataPath').textContent = dir || '—';
  $('tmData').title = dir || '';
}
function dataLocked() {
  return !settings || settings.locked || !settings.configurable;
}
function openDataDialog() {
  closeTreeMenu();
  const dlg = $('dataDialog');
  const locked = dataLocked();
  $('ddTitle').textContent = t('dataFolderTitle');
  $('ddCurrentLabel').textContent = t('dataCurrentLabel');
  $('ddCurrent').textContent = (settings && settings.dataDir) || '';
  $('lbDdPath').textContent = t('dataPathLabel');
  $('ddHint').textContent = t('dataHint');
  $('lbDdMove').textContent = t('dataMove');
  $('ddCancel').textContent = t('cancel');
  $('ddSave').textContent = t('save');
  $('ddPath').value = '';
  $('ddMove').checked = false;
  $('ddLocked').textContent = t('dataLockedMsg');
  $('ddLocked').classList.toggle('hidden', !locked);
  for (const id of ['ddPath', 'ddMove', 'ddSave']) $(id).disabled = locked;
  dlg.showModal();
  if (!locked) $('ddPath').focus();
}
async function saveDataFolder() {
  if (dataLocked()) return;
  const dataDir = $('ddPath').value.trim();
  if (!dataDir) { $('dataDialog').close(); return; }
  const move = $('ddMove').checked;
  if (!await flushBeforeTransition()) return;
  try {
    settings = await store.putSettings({ dataDir, move });
    $('dataDialog').close();
    updateDataRow();
    // the active folder changed — reload the library from the new location
    await refreshTrees();
    let id = currentTreeId;
    if (!trees.find(td => td.id === id)) id = trees[0] && trees[0].id;
    if (id) await openTree(id);
    else resetToEmpty();
    snack(settings.moved ? t('dataMovedSnack', { n: settings.moved }) : t('dataChanged'));
  } catch (e) {
    snack(e.message);
  }
}
function setupDataDialog() {
  $('tmData').onclick = openDataDialog;
  $('ddCancel').onclick = () => $('dataDialog').close();
  $('ddSave').onclick = saveDataFolder;
  $('ddPath').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); saveDataFolder(); }
  });
}

/* ---------------- browser storage row (static / no server) ----------------
 * In server mode the Node "Data folder" row is shown. In browser mode we hide
 * it and show where data lives instead: a real folder (File System Access) or
 * "this browser" (IndexedDB), with an "Open a folder" affordance on browsers
 * that support it. */
function updateStoreRow() {
  const dataRow = $('tmData'), storeRow = $('tmStore');
  if (!dataRow || !storeRow) return;
  if (storeMode === 'server') {
    dataRow.classList.remove('hidden');
    storeRow.classList.add('hidden');
    updateDataRow();
    return;
  }
  dataRow.classList.add('hidden');
  storeRow.classList.remove('hidden');
  const folderBtn = $('tmFolderBtn');
  folderBtn.classList.toggle('hidden', !(supportsFolders() || storeMode === 'fs'));
  if (storeMode === 'fs') {
    $('tmStoreLabel').textContent = t('folderLabel');
    $('tmStorePath').textContent = (store && store.folderName) || '';
    $('tmFolderLabel').textContent = t('changeFolderBtn');
  } else {
    $('tmStoreLabel').textContent = t('storageLabel');
    $('tmStorePath').textContent = t('storedInBrowser');
    $('tmFolderLabel').textContent = t('openFolderBtn');
  }
}
async function pickFolder() {
  closeTreeMenu();
  try {
    if (!await flushBeforeTransition()) return;
    const res = await openFolder(savedHandle);
    if (!res) return;             // user cancelled the picker
    store = res.store; storeMode = res.mode; savedHandle = null;
    await refreshTrees();
    updateStoreRow();
    // open the remembered tree if the folder has it, else the first one, else empty
    const prev = localStorage.getItem('ft_tree');
    const id = (trees.find(td => td.id === prev) && prev) || (trees[0] && trees[0].id);
    if (id) await openTree(id); else resetToEmpty();
    snack(t('folderConnected', { n: store.folderName || '' }));
  } catch (e) { snack(t('folderError') + ': ' + e.message); }
}
function setupStoreRow() {
  $('tmFolderBtn').onclick = pickFolder;
}

/* ---------------- search ---------------- */
function setupSearch() {
  const inp = $('searchInput'), box = $('searchResults');
  function run() {
    if (!model) { box.classList.add('hidden'); inp.setAttribute('aria-expanded', 'false'); return; }
    const q = norm(inp.value.trim());
    if (q.length < 2) { box.classList.add('hidden'); inp.setAttribute('aria-expanded', 'false'); return; }
    const hits = model.people.filter(p => searchText(p).includes(q)).slice(0, 12);
    box.innerHTML = hits.length
      ? hits.map(p =>
        `<button type="button" class="item" role="option" data-id="${esc(p.id)}"><span>${esc(p.name)}</span>` +
        `<span class="meta">${esc(lifeSpan(p))}${placedIds.has(p.id) ? '' : ' <span class="off">· ' + t('offTree') + '</span>'}</span></button>`).join('')
      : `<div class="item" role="option" aria-disabled="true"><span class="meta">${t('noResults')}</span></div>`;
    box.classList.remove('hidden');
    inp.setAttribute('aria-expanded', 'true');
    box.querySelectorAll('[data-id]').forEach(it => {
      it.onclick = () => {
        box.classList.add('hidden');
        inp.setAttribute('aria-expanded', 'false');
        inp.value = '';
        selectPerson(it.dataset.id, { pan: true });
      };
    });
  }
  inp.addEventListener('input', run);
  inp.addEventListener('focus', run);
  inp.addEventListener('keydown', e => {
    if (e.key === 'Escape') { box.classList.add('hidden'); inp.setAttribute('aria-expanded', 'false'); inp.blur(); }
    if (e.key === 'Enter') {
      const first = box.querySelector('[data-id]');
      if (first) first.onclick();
    }
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('.search')) { box.classList.add('hidden'); inp.setAttribute('aria-expanded', 'false'); }
  });
}

/* ---------------- app bar ---------------- */
function applyLabels() {
  document.documentElement.lang = lang;
  $('segFull').textContent = t('modeFull');
  $('segClose').textContent = t('modeClose');
  $('segAnc').textContent = t('modeAnc');
  $('searchInput').placeholder = t('search');
  $('searchInput').setAttribute('aria-label', t('search'));
  $('homeBtn').title = t('home');
  $('homeBtn').setAttribute('aria-label', t('home'));
  $('helpBtn').title = t('welcomeHelp');
  $('helpBtn').setAttribute('aria-label', t('welcomeHelp'));
  $('focusClear').title = t('clearFocus');
  $('focusClear').setAttribute('aria-label', t('clearFocus'));
  applyTheme();
  $('langBtn').textContent = lang === 'tr' ? 'EN' : 'TR';
  $('zoomFit').textContent = t('fit');
  $('zoomIn').setAttribute('aria-label', t('zoomInLabel'));
  $('zoomOut').setAttribute('aria-label', t('zoomOutLabel'));
  $('zoomFit').setAttribute('aria-label', t('fit'));
  $('fab').title = t('fabTitle');
  $('fab').setAttribute('aria-label', t('fabTitle'));
  $('welcomeClose').setAttribute('aria-label', t('closePanel'));
  $('tmNew').querySelector('span').textContent = t('newTree');
  $('tmImport').querySelector('span').textContent = t('importTreeBtn');
  $('tmRename').title = t('renameTree');
  $('tmDuplicate').title = t('duplicateTree');
  $('tmExport').title = t('exportTree');
  $('printBtn').title = t('printView');
  $('printBtn').setAttribute('aria-label', t('printView'));
  $('tmDelete').title = t('deleteTreeBtn');
  $('tmDataLabel').textContent = t('dataFolder');
  updateStoreRow();
  updateTreeButton();
  document.querySelectorAll('#modeSeg button').forEach(b => {
    const active = b.dataset.mode === mode;
    b.classList.toggle('active', active);
    b.setAttribute('aria-pressed', String(active));
  });
  if (!dirty) setStatus('saved', model ? '✓ ' + t('saved') : '');
}

function setupAppbar() {
  document.querySelectorAll('#modeSeg button').forEach(btn => {
    btn.onclick = () => {
      mode = btn.dataset.mode;
      localStorage.setItem('ft_mode', mode);
      applyLabels();
      renderTree();
      fitView();
      renderPanel();
    };
  });
  $('homeBtn').onclick = () => { if (rootId) setFocus(rootId); };
  $('focusClear').onclick = () => { if (rootId) setFocus(rootId); };
  $('themeBtn').onclick = () => {
    theme = theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('ft_theme', theme);
    applyTheme();
  };
  $('langBtn').onclick = () => {
    lang = lang === 'tr' ? 'en' : 'tr';
    localStorage.setItem('ft_lang', lang);
    applyLabels();
    renderTree();
    renderPanel();
  };
  $('fab').onclick = () => openAddDialog('standalone', selectedId);
}

/* ---------------- init ---------------- */
(async function init() {
  applyTheme();
  setupCanvas();
  setupSearch();
  setupAppbar();
  setupAddDialog();
  setupTreeLibrary();
  setupDataDialog();
  setupStoreRow();
  setupWelcome();
  setupPrint();
  try {
    const picked = await pickStore();
    store = picked.store; storeMode = picked.mode; savedHandle = picked.savedHandle;
    await refreshTrees();
    if (storeMode === 'server') await refreshSettings();
  } catch (e) {
    document.body.innerHTML = '<p style="padding:40px;font-size:16px">Could not load your trees: ' + esc(e.message) + '</p>';
    return;
  }
  let id = localStorage.getItem('ft_tree');
  if (!trees.find(td => td.id === id)) id = trees[0] && trees[0].id;
  let opened = false;
  if (id) {
    try { await openTree(id); opened = true; } catch (e) { snack(t('loadError') + ': ' + e.message); }
  }
  if (!opened) { applyLabels(); renderTree(); }
  maybeWelcome();
})();
