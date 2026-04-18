/**
 * Açıl Susam — arayüz çevirileri (Ayarlar > Dil tercihi ile senkron)
 * Eksik anahtar: seçilen dil → en → tr
 */
(function (global) {
  const STORAGE_KEY = 'acil_susam_lang';
  const LANGS = ['tr', 'en', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'ru', 'ar'];

  const TR = {
    dockHome: 'Ana Sayfa',
    dockYoutube: 'YouTube',
    dockTv: 'Canlı TV',
    dockIptv: 'IPTV',
    dockNavigation: 'Navigasyon',
    dockSettings: 'Ayarlar',
    dockBackAria: 'Bölüm ana sayfasına dön',
    homeWelcomeH1: 'Hoş Geldiniz',
    homeWelcomeP: 'Aşağıdan bir bölüm seçin',
    tvEmptyTitle: 'Canlı TV',
    tvEmptySubtitle: 'Sağ listeden kanal seçin',
    tvSearchPh: 'Kanal ara…',
    tvCatAll: 'Tümü',
    tvCatNews: 'Haber',
    tvCatNational: 'Ulusal',
    tvCatDocumentary: 'Belgesel',
    tvCatKids: 'Çocuk',
    tvCatMusic: 'Müzik',
    tvCatSports: 'Spor',
    iptvEmptyMsg: 'KURULUMU AYARLAR MENÜSÜNDEN IPTV BÖLÜMÜNDEN YAPMANIZ GEREKİYOR.',
    ytModeSearch: 'ARAMA',
    ytModeLink: 'LİNK',
    ytPhSearch: 'Buraya aramak istediğiniz kelimeleri yazın…',
    ytPhLink: 'YouTube video bağlantısını yapıştırın…',
    ytBtnSearch: 'Ara',
    ytBtnOpenLink: 'Linki Aç',
    ytFeedSmart: 'SEZGİSEL SEÇİMLER',
    ytFeedHistory: 'GEÇMİŞ',
    ytLoading: 'Yükleniyor…',
    ytNoResults: 'Sonuç bulunamadı',
    ytNoRelated: 'İlgili video bulunamadı',
    ytLoadingTitle: 'Yükleniyor…',
    ytVideoTitle: 'Video',
    ytStreamFail: 'Stream alınamadı.',
    ytSearching: 'Aranıyor…',
    ytSearchFailApi: 'Arama başarısız.',
    ytInvalidResponse: 'Geçersiz yanıt.',
    ytSearchFail: 'Arama başarısız.',
    ytConnectFail: 'Sunucuya bağlanılamadı.',
    ytHistoryLoading: 'Geçmiş videolar hazırlanıyor…',
    ytHistoryEmpty: 'Henüz izleme geçmişi bulunamadı',
    ytSmartLoading: 'Sana uygun videolar hazırlanıyor…',
    ytTrendingFallback: 'Trend içerikler yükleniyor…',
    ytHintSearchYoutube: 'YouTube\'da bir şeyler ara',
    ytHintStartSearch: 'Aramaya başla',
    ytReprepareVideo: 'Video tekrar hazırlanıyor…',
    ytRestartFailVideo: 'Video tekrar başlatılamadı.',
    menuUserDefault: 'Kullanıcı',
    menuSessionOpen: 'Oturum açık',
    menuAccountSettings: 'Hesap Ayarları',
    menuSwitchUser: 'Kullanıcı Değiştir',
    menuGoogleAccount: 'Google Hesabı Seç',
    menuLogout: 'Hesaptan Çık',
    navOriginPh: 'Adres veya enlem,boylam',
    navDestPh: 'Hedef adres veya yer adı',
    navModeDriving: 'Araç',
    navModeWalking: 'Yürüyüş',
    navModeBicycle: 'Bisiklet',
    navModeTransit: 'Toplu taşıma',
    navMyLocation: 'Konumum',
    navShowRoute: 'Rotayı göster',
    navOpenMaps: 'Haritalarda aç',
    navLabelOrigin: 'Nereden',
    navLabelDest: 'Nereye',
    navLabelMode: 'Mod',
    navGpsTitle: 'Nereden alanına GPS koordinatı yazar',
    mapFrameTitle: 'Yol tarifi haritası',
    tvBtnPlayPause: 'Oynat / Duraklat',
    tvBtnMute: 'Sesi Aç / Kapat',
    tvBtnFs: 'Tam ekran',
    ytBtnBack: 'Geri',
    ytBtnFs: 'Tam ekran',
    navPlaceholderTitle: 'Navigasyon / yol tarifi',
    navPlaceholderP: 'Üstte Nereden ve Nereye doldurup Rotayı göster deyin. Araç içinde sesli tam navigasyon için Haritalarda aç ile Google Haritalar sekmesini kullanın.',
    navPlaceholderKeyTitle: 'Harita anahtarı yok',
    navPlaceholderKeyP: 'Gömülü harita için sunucuda GOOGLE_MAPS_EMBED_API_KEY tanımlayın; Google Cloud’da Maps Embed API etkin olsun. Anahtar olmadan da Haritalarda aç ile Google Haritalar üzerinden navigasyonu kullanabilirsiniz.',
    navAlertNoBrowserGeo: 'Tarayıcı konum desteği vermiyor.',
    navAlertGeoFail: 'Konum alınamadı. İzin ve HTTPS (veya localhost) ayarlarını kontrol edin.',
    navAlertDest: 'Nereye alanını doldurun.',
    navAlertOrigin: 'Nereden alanını doldurun veya Konumum ile koordinat yazdırın.',
    navAlertNoKey: 'Gömülü harita için GOOGLE_MAPS_EMBED_API_KEY gerekli. Tam navigasyon için Haritalarda aç düğmesini kullanın.',
    confirmLogout: 'Hesaptan çıkmak istediğinize emin misiniz?',
    alertPopupBlocked: 'Yeni hesap penceresi açılamadı. Tarayıcı açılır pencereyi engelliyor olabilir.',
    alertSwitchUser: 'Yeni kullanıcı girişini açtık. Giriş tamamlandıktan sonra bu sayfayı yenileyebilirsiniz.',
    channelsNoneTitle: 'Kanal yok.',
    channelsNoneBody: 'Kanal ekleme ve düzenleme için Ayarlar menüsündeki TV bölümünü kullanın.',
    listLoading: 'Yükleniyor…',
    listFailed: 'Liste alınamadı.',
    iptvListEmpty: 'Liste alınamadı.',
    loginPageTitle: 'Açıl Susam — Giriş',
    loginSubtitle: 'Seyahat halinde kesintisiz yayın',
    loginGoogleBtn: 'Google ile Giriş Yap',
    loginInfo: 'Giriş yaparak üyeliğinizi aktifleştirin.\nHesabınız yoksa otomatik olarak oluşturulur.',
    loginTheaterBold: 'Araç tam ekran / tiyatro modu için:',
    loginErrGoogleDenied: 'Google girişi iptal edildi.',
    loginErrAccountSuspended: 'Hesabınız askıya alınmış. Lütfen destek ile iletişime geçin.',
    loginErrMembership: 'Üyelik paketiniz aktif değil.',
    loginErrServer: 'Sunucu hatası oluştu. Lütfen tekrar deneyin.',
    loginErrIpLocked: 'Bu hesap başka bir konumdan kullanılıyor.',
    ipBlockedTitle: 'Erişim Engellendi',
    ipBlockedBody: 'Bu hesap farklı bir konumdan veya cihazdan kullanılıyor.\n\nHer kullanıcı hesabı yalnızca tek bir lokasyondan kullanılabilir. IP adresinizi sıfırlamak için üyelik sahibiyle iletişime geçin.',
    ipBlockedBtn: 'Giriş Sayfasına Dön',
    manageTabAccount: 'Hesap ve Kullanıcılar',
    manageTabYoutube: 'YouTube',
    manageTabTv: 'TV',
    manageTabIptv: 'IPTV',
    manageTabOther: 'Diğer Ayarlar',
    manageCardPlan: 'Paket Bilgisi',
    manageCardSession: 'Oturum İşlemleri',
    manageSessionP: 'Aynı araçta farklı kullanıcıların giriş yapabilmesi için hesap değiştirebilirsiniz.',
    manageBtnSwitchAccount: 'Hesap Değiştir',
    manageCardInterests: 'YouTube İlgi Etiketleri',
    manageInterestsP: 'Virgülle ayırın. Sağ panel önerileri bu etiketlere göre ağırlıklandırılır.',
    manageInterestsPh: 'dizi, film, haber, spor, müzik',
    manageBtnSave: 'Kaydet',
    manageCardLanguage: 'Dil Tercihi',
    manageLanguageP: 'Arayüz ve sağ panel önerileri bu dile göre ayarlanır.',
    manageBtnSaveLanguage: 'Dili Kaydet',
    manageCardTv: 'TV Kanalları Ayarla',
    manageTvP: 'Tik kaldırırsanız kanal TV ekranında görünmez. İsterseniz kendi güvenilir bağlantınızı girebilirsiniz.',
    manageTvPreview: 'Ön izleme için bir kanal seçin.',
    manageUsers: 'Kullanıcılar',
    manageThAvatar: '',
    manageThName: 'Ad / E-posta',
    manageThRole: 'Rol',
    manageThIp: 'IP Kilidi',
    manageThStatus: 'Durum',
    manageThAction: 'İşlem',
    manageInviteTitle: 'Kullanıcı Davet Et',
    manageInviteP: 'Davet ettiğiniz kişi Google hesabıyla ilk giriş yaptığında otomatik olarak paketinize eklenir.',
    manageInvitePh: 'ornek@gmail.com',
    manageInviteSend: 'Davet Gönder',
    manageIptvM3uTitle: 'IPTV — M3U (sunucu)',
    manageIptvM3uP: 'Liste metni veritabanında saklanır; tüm paket kullanıcıları aynı kanalları görür. Yalnızca paket sahibi yükleyebilir veya silebilir.',
    manageIptvM3uUpload: 'M3U Yükle',
    manageIptvM3uRemove: 'M3U Kaldır',
    manageIptvM3uMember: 'M3U yönetimi için paket sahibi olmalısınız. Oynatıcıda IPTV sekmesi paket listesini kullanır.',
    manageIptvXtTitle: 'IPTV — Xtream (panel API)',
    manageIptvXtP: 'Sunucu kök adresi (ör. https://ornek.com:8080), kullanıcı adı ve şifre. Kanallar player_api ile birleştirilir.',
    manageIptvXtUserPh: 'Kullanıcı adı',
    manageIptvXtPassPh: 'Şifre (değiştirmek için yazın)',
    manageIptvXtSave: 'Xtream Ayarlarını Kaydet',
    manageIptvXtMember: 'Xtream ayarlarını yalnızca paket sahibi değiştirebilir.',
    manageIptvEpgTitle: 'IPTV — EPG (XMLTV)',
    manageIptvEpgP: 'Program rehberi için XMLTV adresi veya dosya.',
    manageIptvEpgUrlSave: 'EPG URL Kaydet',
    manageIptvEpgUpload: 'XMLTV Dosyası Yükle',
    manageIptvEpgDelete: 'Yüklenen XML Sil',
    manageIptvEpgMember: 'EPG ayarlarını yalnızca paket sahibi değiştirebilir.',
    manageSourceTitle: 'Kaynak seç',
    manageSourceTitleNamed: '{name} kaynakları',
    manageSourceBadJson: 'Sunucu JSON yerine farklı bir yanıt döndürdü. Lütfen sunucuyu yeniden başlatıp tekrar deneyin.',
    manageSourceConnErr: 'Araştırma sırasında bağlantı hatası oluştu.',
    errUnknown: 'Bilinmeyen hata',
    manageBtnClose: 'Kapat',
    manageBtnOk: 'Tamam',
    manageRoleOwner: 'Sahip',
    manageRoleMember: 'Üye',
    manageIpNone: 'Henüz kilitlenmedi',
    manageStatusActive: 'Aktif',
    manageStatusInactive: 'Pasif',
    manageResetIp: 'IP Sıfırla',
    manageDash: '—',
    manageTvNoChannels: 'Kanal bulunamadı.',
    manageTvResearch: 'Araştır/Tazele',
    manageTvPreviewBtn: 'Önizle',
    manageTvSaveRow: 'Kaydet',
    managePlanStat: '{n} / {max} kullanıcı  •  Durum: {status}',
    manageMshipActive: 'aktif',
    manageMshipInactive: 'pasif',
    manageXtreamTesting: 'Bağlantı deneniyor…',
    manageXtreamSaving: 'Kaydediliyor…',
    manageXtreamOk: 'Bağlantı başarılı.',
    manageXtreamFail: 'Bağlantı kurulamadı.',
    manageXtreamRequestFail: 'İstek gönderilemedi. Ağı kontrol edin.',
    manageSourceSearching: 'Kaynaklar araştırılıyor…',
    manageSourceNone: 'Kaynak bulunamadı.',
    manageSourcePicked: 'Kaynak adres satırına aktarıldı. Kaydet ile onaylayın.',
    manageSourceHealthy: 'doğrulandı',
    manageSourceWeak: 'zayıf',
    managePreviewDraft: 'Taslak URL (kaydedilmedi)',
    managePreviewSaved: 'Kayıtlı URL',
    toastLangOk: 'Dil tercihi güncellendi.',
    toastInterestsOk: 'İlgi etiketleri güncellendi.',
    toastInviteOkPrefix: '',
    toastPageLoadErr: 'Sayfa tam yüklenemedi. Sayfayı yenileyin.',
    toastPopupBlockedManage: 'Yeni hesap penceresi açılamadı. Açılır pencereye izin verin.',
    toastSwitchUserManage: 'Yeni kullanıcı girişi için pencere açıldı. Girişten sonra sayfayı yenileyin.',
    confirmDeleteM3u: 'Kayıtlı M3U listesini silmek istediğinize emin misiniz?',
    confirmDeleteEpg: 'Sunucuya yüklenen XMLTV dosyasını silmek istiyor musunuz?',
    toastSelectM3u: 'Önce bir .m3u dosyası seçin.',
    toastM3uSaved: 'M3U kaydedildi.',
    toastM3uUploadErr: 'Yükleme sırasında hata oluştu.',
    toastM3uRemoved: 'M3U kaldırıldı.',
    toastOpFail: 'İşlem başarısız.',
    toastXmlSaved: 'XMLTV kaydedildi.',
    toastSelectXml: 'XML dosyası seçin.',
    toastEpgSaved: 'EPG ve diğer alanlar kaydedildi.',
    toastEpgXmlRemoved: 'Yerel XMLTV silindi.',
    toastXtreamSavedOk: 'Ayarlar kaydedildi; Xtream sunucusu doğrulandı.',
    toastXtreamSaved: 'Ayarlar kaydedildi.',
    toastXtreamSavedWarn: 'Ayarlar kaydedildi; Xtream bağlantısı doğrulanamadı.',
    toastXtreamSaveErr: 'Kayıt sırasında hata oluştu.',
    toastTvVisibility: 'Kanal görünürlüğü güncellendi.',
    toastTvUrlSaved: 'Özel bağlantı kaydedildi.',
    toastIpResetNamed: '{name} için IP kilidi sıfırlandı.',
    iptvStatusM3uNone: 'Kayıtlı M3U yok.',
    iptvStatusM3uPrefix: 'Kayıtlı liste:',
    iptvStatusM3uBytes: 'bayt · Güncelleme:',
    iptvPassPh: 'Şifre',
    iptvPassSavedPh: 'Şifre kayıtlı (sadece sahip görebilir)',
    iptvEpgLocal: 'Yerel XMLTV yüklü ·',
    iptvEpgUrlPrefix: 'EPG URL:',
    iptvEpgNone: 'EPG tanımlı değil.',
  };

  const EN = {
    dockHome: 'Home',
    dockYoutube: 'YouTube',
    dockTv: 'Live TV',
    dockIptv: 'IPTV',
    dockNavigation: 'Navigation',
    dockSettings: 'Settings',
    dockBackAria: 'Back to section home',
    homeWelcomeH1: 'Welcome',
    homeWelcomeP: 'Choose a section below',
    tvEmptyTitle: 'Live TV',
    tvEmptySubtitle: 'Pick a channel from the list',
    tvSearchPh: 'Search channels…',
    tvCatAll: 'All',
    tvCatNews: 'News',
    tvCatNational: 'National',
    tvCatDocumentary: 'Documentary',
    tvCatKids: 'Kids',
    tvCatMusic: 'Music',
    tvCatSports: 'Sports',
    iptvEmptyMsg: 'CONFIGURE IPTV IN SETTINGS > IPTV.',
    ytModeSearch: 'SEARCH',
    ytModeLink: 'LINK',
    ytPhSearch: 'Type what you want to search…',
    ytPhLink: 'Paste a YouTube video link…',
    ytBtnSearch: 'Search',
    ytBtnOpenLink: 'Open link',
    ytFeedSmart: 'SMART PICKS',
    ytFeedHistory: 'HISTORY',
    ytLoading: 'Loading…',
    ytNoResults: 'No results',
    ytNoRelated: 'No related videos',
    ytLoadingTitle: 'Loading…',
    ytVideoTitle: 'Video',
    ytStreamFail: 'Could not load stream.',
    ytSearching: 'Searching…',
    ytSearchFailApi: 'Search failed.',
    ytInvalidResponse: 'Invalid response.',
    ytSearchFail: 'Search failed.',
    ytConnectFail: 'Could not reach the server.',
    ytHistoryLoading: 'Loading watch history…',
    ytHistoryEmpty: 'No watch history yet',
    ytSmartLoading: 'Preparing personalized picks…',
    ytTrendingFallback: 'Loading trending…',
    ytHintSearchYoutube: 'Search for something on YouTube',
    ytHintStartSearch: 'Start a search',
    ytReprepareVideo: 'Preparing video again…',
    ytRestartFailVideo: 'Could not restart the video.',
    menuUserDefault: 'User',
    menuSessionOpen: 'Signed in',
    menuAccountSettings: 'Account settings',
    menuSwitchUser: 'Switch user',
    menuGoogleAccount: 'Choose Google account',
    menuLogout: 'Sign out',
    navOriginPh: 'Address or lat,lng',
    navDestPh: 'Destination address or place',
    navModeDriving: 'Driving',
    navModeWalking: 'Walking',
    navModeBicycle: 'Cycling',
    navModeTransit: 'Transit',
    navMyLocation: 'My location',
    navShowRoute: 'Show route',
    navOpenMaps: 'Open in Maps',
    navLabelOrigin: 'From',
    navLabelDest: 'To',
    navLabelMode: 'Mode',
    navGpsTitle: 'Writes GPS coordinates into the From field',
    mapFrameTitle: 'Directions map',
    tvBtnPlayPause: 'Play / Pause',
    tvBtnMute: 'Mute / Unmute',
    tvBtnFs: 'Fullscreen',
    ytBtnBack: 'Back',
    ytBtnFs: 'Fullscreen',
    navPlaceholderTitle: 'Navigation / directions',
    navPlaceholderP: 'Fill From and To, then Show route. For full voice navigation in the car, use Open in Maps.',
    navPlaceholderKeyTitle: 'No map API key',
    navPlaceholderKeyP: 'Set GOOGLE_MAPS_EMBED_API_KEY on the server and enable Maps Embed API. Without a key you can still use Open in Maps.',
    navAlertNoBrowserGeo: 'This browser does not support geolocation.',
    navAlertGeoFail: 'Could not get location. Check permissions and HTTPS (or localhost).',
    navAlertDest: 'Please fill in the destination.',
    navAlertOrigin: 'Please fill in the origin or use My location.',
    navAlertNoKey: 'An embed API key is required for the inline map. Use Open in Maps for full navigation.',
    confirmLogout: 'Are you sure you want to sign out?',
    alertPopupBlocked: 'Could not open a new window. Your browser may be blocking pop-ups.',
    alertSwitchUser: 'We opened sign-in in a new window. After signing in, you can refresh this page.',
    channelsNoneTitle: 'No channels.',
    channelsNoneBody: 'Add or edit channels in Settings > TV.',
    listLoading: 'Loading…',
    listFailed: 'Could not load the list.',
    iptvListEmpty: 'Could not load the list.',
    loginPageTitle: 'Açıl Susam — Sign in',
    loginSubtitle: 'Uninterrupted playback on the move',
    loginGoogleBtn: 'Sign in with Google',
    loginInfo: 'Sign in to activate your membership.\nIf you have no account, one is created automatically.',
    loginTheaterBold: 'For vehicle fullscreen / theater mode:',
    loginErrGoogleDenied: 'Google sign-in was cancelled.',
    loginErrAccountSuspended: 'Your account is suspended. Please contact support.',
    loginErrMembership: 'Your membership is not active.',
    loginErrServer: 'A server error occurred. Please try again.',
    loginErrIpLocked: 'This account is in use from another location.',
    ipBlockedTitle: 'Access denied',
    ipBlockedBody: 'This account is being used from another location or device.\n\nEach account may only be used from one location. Contact the subscription owner to reset your IP.',
    ipBlockedBtn: 'Back to sign-in',
    manageTabAccount: 'Account & users',
    manageTabYoutube: 'YouTube',
    manageTabTv: 'TV',
    manageTabIptv: 'IPTV',
    manageTabOther: 'Other settings',
    manageCardPlan: 'Subscription',
    manageCardSession: 'Session',
    manageSessionP: 'Switch account so different users can sign in on the same device.',
    manageBtnSwitchAccount: 'Switch account',
    manageCardInterests: 'YouTube interest tags',
    manageInterestsP: 'Comma-separated. Sidebar suggestions are weighted using these tags.',
    manageInterestsPh: 'series, movies, news, sports, music',
    manageBtnSave: 'Save',
    manageCardLanguage: 'Language',
    manageLanguageP: 'The interface and sidebar suggestions follow this language.',
    manageBtnSaveLanguage: 'Save language',
    manageCardTv: 'TV channels',
    manageTvP: 'Uncheck to hide a channel on TV. You can enter your own stream URL.',
    manageTvPreview: 'Select a channel for preview.',
    manageUsers: 'Users',
    manageThAvatar: '',
    manageThName: 'Name / email',
    manageThRole: 'Role',
    manageThIp: 'IP lock',
    manageThStatus: 'Status',
    manageThAction: 'Action',
    manageInviteTitle: 'Invite user',
    manageInviteP: 'When the invited person signs in with Google for the first time, they join your subscription.',
    manageInvitePh: 'user@gmail.com',
    manageInviteSend: 'Send invite',
    manageIptvM3uTitle: 'IPTV — M3U (server)',
    manageIptvM3uP: 'The playlist is stored in the database; all users in the subscription see the same channels. Only the owner can upload or remove.',
    manageIptvM3uUpload: 'Upload M3U',
    manageIptvM3uRemove: 'Remove M3U',
    manageIptvM3uMember: 'You must be the subscription owner to manage M3U. The IPTV tab uses the shared list.',
    manageIptvXtTitle: 'IPTV — Xtream (panel API)',
    manageIptvXtP: 'Server base URL (e.g. https://example.com:8080), username and password. Channels are merged via player_api.',
    manageIptvXtUserPh: 'Username',
    manageIptvXtPassPh: 'Password (type to change)',
    manageIptvXtSave: 'Save Xtream settings',
    manageIptvXtMember: 'Only the subscription owner can change Xtream settings.',
    manageIptvEpgTitle: 'IPTV — EPG (XMLTV)',
    manageIptvEpgP: 'XMLTV URL or file for the programme guide.',
    manageIptvEpgUrlSave: 'Save EPG URL',
    manageIptvEpgUpload: 'Upload XMLTV file',
    manageIptvEpgDelete: 'Delete uploaded XML',
    manageIptvEpgMember: 'Only the subscription owner can change EPG settings.',
    manageSourceTitle: 'Choose source',
    manageSourceTitleNamed: '{name} — sources',
    manageSourceBadJson: 'The server returned a non-JSON response. Restart the server and try again.',
    manageSourceConnErr: 'A connection error occurred while searching.',
    errUnknown: 'Unknown error',
    manageBtnClose: 'Close',
    manageBtnOk: 'OK',
    manageRoleOwner: 'Owner',
    manageRoleMember: 'Member',
    manageIpNone: 'Not locked yet',
    manageStatusActive: 'Active',
    manageStatusInactive: 'Inactive',
    manageResetIp: 'Reset IP',
    manageDash: '—',
    manageTvNoChannels: 'No channels found.',
    manageTvResearch: 'Refresh sources',
    manageTvPreviewBtn: 'Preview',
    manageTvSaveRow: 'Save',
    managePlanStat: '{n} / {max} users  •  Status: {status}',
    manageMshipActive: 'active',
    manageMshipInactive: 'inactive',
    manageXtreamTesting: 'Testing connection…',
    manageXtreamSaving: 'Saving…',
    manageXtreamOk: 'Connection successful.',
    manageXtreamFail: 'Could not connect.',
    manageXtreamRequestFail: 'Request failed. Check your network.',
    manageSourceSearching: 'Searching sources…',
    manageSourceNone: 'No sources found.',
    manageSourcePicked: 'URL copied to the field. Press Save to confirm.',
    manageSourceHealthy: 'ok',
    manageSourceWeak: 'weak',
    managePreviewDraft: 'Draft URL (not saved)',
    managePreviewSaved: 'Saved URL',
    toastLangOk: 'Language preference updated.',
    toastInterestsOk: 'Interest tags updated.',
    toastInviteOkPrefix: '',
    toastPageLoadErr: 'Page did not load fully. Please refresh.',
    toastPopupBlockedManage: 'Could not open a new window. Allow pop-ups.',
    toastSwitchUserManage: 'Sign-in window opened. Refresh after signing in.',
    confirmDeleteM3u: 'Delete the saved M3U playlist?',
    confirmDeleteEpg: 'Delete the uploaded XMLTV file from the server?',
    toastSelectM3u: 'Select a .m3u file first.',
    toastM3uSaved: 'M3U saved.',
    toastM3uUploadErr: 'Error while uploading.',
    toastM3uRemoved: 'M3U removed.',
    toastOpFail: 'Operation failed.',
    toastXmlSaved: 'XMLTV saved.',
    toastSelectXml: 'Select an XML file.',
    toastEpgSaved: 'EPG and other fields saved.',
    toastEpgXmlRemoved: 'Local XMLTV removed.',
    toastXtreamSavedOk: 'Settings saved; Xtream server verified.',
    toastXtreamSaved: 'Settings saved.',
    toastXtreamSavedWarn: 'Settings saved; Xtream could not be verified.',
    toastXtreamSaveErr: 'Error while saving.',
    toastTvVisibility: 'Channel visibility updated.',
    toastTvUrlSaved: 'Custom URL saved.',
    toastIpResetNamed: 'IP lock reset for {name}',
    iptvStatusM3uNone: 'No M3U saved.',
    iptvStatusM3uPrefix: 'Saved list:',
    iptvStatusM3uBytes: 'bytes · Updated:',
    iptvPassPh: 'Password',
    iptvPassSavedPh: 'Password on file (owner only)',
    iptvEpgLocal: 'Local XMLTV loaded ·',
    iptvEpgUrlPrefix: 'EPG URL:',
    iptvEpgNone: 'No EPG configured.',
  };

  function merge(base, patch) {
    const o = {};
    Object.keys(base).forEach((k) => { o[k] = base[k]; });
    if (patch) Object.keys(patch).forEach((k) => { o[k] = patch[k]; });
    return o;
  }

  const DE = merge(EN, {
    dockHome: 'Startseite',
    homeWelcomeH1: 'Willkommen',
    homeWelcomeP: 'Wählen Sie unten einen Bereich',
    dockTv: 'Live-TV',
    dockSettings: 'Einstellungen',
    dockNavigation: 'Navigation',
    tvSearchPh: 'Sender suchen…',
    ytBtnSearch: 'Suchen',
    manageTabAccount: 'Konto & Benutzer',
    manageTabOther: 'Weitere Einstellungen',
    manageBtnSave: 'Speichern',
    manageBtnSaveLanguage: 'Sprache speichern',
    manageCardLanguage: 'Sprache',
    manageLanguageP: 'Oberfläche und Vorschläge folgen dieser Sprache.',
    confirmLogout: 'Wirklich abmelden?',
    menuLogout: 'Abmelden',
    loginGoogleBtn: 'Mit Google anmelden',
  });

  const FR = merge(EN, {
    dockHome: 'Accueil',
    homeWelcomeH1: 'Bienvenue',
    homeWelcomeP: 'Choisissez une section ci-dessous',
    dockTv: 'TV en direct',
    dockSettings: 'Réglages',
    dockNavigation: 'Navigation',
    tvSearchPh: 'Rechercher une chaîne…',
    ytBtnSearch: 'Rechercher',
    manageTabAccount: 'Compte et utilisateurs',
    manageTabOther: 'Autres réglages',
    manageBtnSave: 'Enregistrer',
    manageBtnSaveLanguage: 'Enregistrer la langue',
    manageCardLanguage: 'Langue',
    manageLanguageP: 'L’interface et les suggestions suivent cette langue.',
    confirmLogout: 'Voulez-vous vraiment vous déconnecter ?',
    menuLogout: 'Se déconnecter',
    loginGoogleBtn: 'Se connecter avec Google',
  });

  const ES = merge(EN, {
    dockHome: 'Inicio',
    homeWelcomeH1: 'Bienvenido',
    homeWelcomeP: 'Elija una sección abajo',
    dockTv: 'TV en vivo',
    dockSettings: 'Ajustes',
    dockNavigation: 'Navegación',
    tvSearchPh: 'Buscar canales…',
    ytBtnSearch: 'Buscar',
    manageTabAccount: 'Cuenta y usuarios',
    manageTabOther: 'Otros ajustes',
    manageBtnSave: 'Guardar',
    manageBtnSaveLanguage: 'Guardar idioma',
    manageCardLanguage: 'Idioma',
    manageLanguageP: 'La interfaz y las sugerencias usan este idioma.',
    confirmLogout: '¿Cerrar sesión?',
    menuLogout: 'Cerrar sesión',
    loginGoogleBtn: 'Entrar con Google',
  });

  const IT = merge(EN, {
    dockHome: 'Home',
    homeWelcomeH1: 'Benvenuto',
    homeWelcomeP: 'Scegli una sezione qui sotto',
    dockTv: 'TV in diretta',
    dockSettings: 'Impostazioni',
    dockNavigation: 'Navigazione',
    tvSearchPh: 'Cerca canali…',
    ytBtnSearch: 'Cerca',
    manageTabAccount: 'Account e utenti',
    manageTabOther: 'Altre impostazioni',
    manageBtnSave: 'Salva',
    manageBtnSaveLanguage: 'Salva lingua',
    manageCardLanguage: 'Lingua',
    manageLanguageP: 'Interfaccia e suggerimenti seguono questa lingua.',
    confirmLogout: 'Uscire dall’account?',
    menuLogout: 'Esci',
    loginGoogleBtn: 'Accedi con Google',
  });

  const PT = merge(EN, {
    dockHome: 'Início',
    homeWelcomeH1: 'Bem-vindo',
    homeWelcomeP: 'Escolha uma secção abaixo',
    dockTv: 'TV ao vivo',
    dockSettings: 'Definições',
    dockNavigation: 'Navegação',
    tvSearchPh: 'Pesquisar canais…',
    ytBtnSearch: 'Pesquisar',
    manageTabAccount: 'Conta e utilizadores',
    manageTabOther: 'Outras definições',
    manageBtnSave: 'Guardar',
    manageBtnSaveLanguage: 'Guardar idioma',
    manageCardLanguage: 'Idioma',
    manageLanguageP: 'A interface e as sugestões seguem este idioma.',
    confirmLogout: 'Terminar sessão?',
    menuLogout: 'Sair',
    loginGoogleBtn: 'Entrar com o Google',
  });

  const NL = merge(EN, {
    dockHome: 'Home',
    homeWelcomeH1: 'Welkom',
    homeWelcomeP: 'Kies hieronder een onderdeel',
    dockTv: 'Live-tv',
    dockSettings: 'Instellingen',
    dockNavigation: 'Navigatie',
    tvSearchPh: 'Zenders zoeken…',
    ytBtnSearch: 'Zoeken',
    manageTabAccount: 'Account en gebruikers',
    manageTabOther: 'Overige instellingen',
    manageBtnSave: 'Opslaan',
    manageBtnSaveLanguage: 'Taal opslaan',
    manageCardLanguage: 'Taal',
    manageLanguageP: 'Interface en suggesties volgen deze taal.',
    confirmLogout: 'Afmelden?',
    menuLogout: 'Afmelden',
    loginGoogleBtn: 'Inloggen met Google',
  });

  const RU = merge(EN, {
    dockHome: 'Главная',
    homeWelcomeH1: 'Добро пожаловать',
    homeWelcomeP: 'Выберите раздел ниже',
    dockTv: 'Прямой эфир',
    dockSettings: 'Настройки',
    dockNavigation: 'Навигация',
    tvSearchPh: 'Поиск каналов…',
    ytBtnSearch: 'Поиск',
    manageTabAccount: 'Аккаунт и пользователи',
    manageTabOther: 'Другие настройки',
    manageBtnSave: 'Сохранить',
    manageBtnSaveLanguage: 'Сохранить язык',
    manageCardLanguage: 'Язык',
    manageLanguageP: 'Интерфейс и подсказки на выбранном языке.',
    confirmLogout: 'Выйти из аккаунта?',
    menuLogout: 'Выйти',
    loginGoogleBtn: 'Войти через Google',
  });

  const AR = merge(EN, {
    dockHome: 'الرئيسية',
    homeWelcomeH1: 'مرحباً',
    homeWelcomeP: 'اختر قسماً من الأسفل',
    dockTv: 'بث مباشر',
    dockSettings: 'الإعدادات',
    dockNavigation: 'التنقل',
    tvSearchPh: 'بحث عن قنوات…',
    ytBtnSearch: 'بحث',
    manageTabAccount: 'الحساب والمستخدمون',
    manageTabOther: 'إعدادات أخرى',
    manageBtnSave: 'حفظ',
    manageBtnSaveLanguage: 'حفظ اللغة',
    manageCardLanguage: 'اللغة',
    manageLanguageP: 'الواجهة والاقتراحات تتبع هذه اللغة.',
    confirmLogout: 'هل تريد تسجيل الخروج؟',
    menuLogout: 'تسجيل الخروج',
    loginGoogleBtn: 'تسجيل الدخول عبر Google',
  });

  const STRINGS = { tr: TR, en: EN, de: DE, fr: FR, es: ES, it: IT, pt: PT, nl: NL, ru: RU, ar: AR };

  function interpolate(str, vars) {
    if (!vars || typeof str !== 'string') return str;
    return str.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? String(vars[k]) : ''));
  }

  function pick(lang, key) {
    const L = LANGS.includes(lang) ? lang : 'tr';
    const pack = STRINGS[L];
    if (pack && pack[key] != null && pack[key] !== '') return pack[key];
    if (STRINGS.en[key] != null) return STRINGS.en[key];
    return STRINGS.tr[key] != null ? STRINGS.tr[key] : key;
  }

  const AppI18n = {
    _lang: 'tr',
    setLanguage(lang) {
      let L = String(lang || 'tr').toLowerCase();
      if (!LANGS.includes(L)) L = 'tr';
      this._lang = L;
      try {
        global.localStorage.setItem(STORAGE_KEY, L);
      } catch (err) {
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[i18n] localStorage', err.message);
        }
      }
      if (typeof document !== 'undefined' && document.documentElement) {
        document.documentElement.setAttribute('lang', L);
        document.documentElement.setAttribute('dir', L === 'ar' ? 'rtl' : 'ltr');
      }
    },
    getLanguage() {
      return this._lang;
    },
    t(key, vars) {
      return interpolate(pick(this._lang, key), vars);
    },
    readStoredLanguage() {
      try {
        const s = global.localStorage.getItem(STORAGE_KEY);
        if (s && LANGS.includes(s)) return s;
      } catch (err) {
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[i18n] readStoredLanguage', err.message);
        }
      }
      return null;
    },
    applyStatic(root) {
      const r = root || document;
      if (!r || !r.querySelectorAll) return;
      r.querySelectorAll('[data-i18n]').forEach((el) => {
        const key = el.getAttribute('data-i18n');
        if (!key) return;
        let vars = null;
        const raw = el.getAttribute('data-i18n-vars');
        if (raw) {
          try {
            vars = JSON.parse(raw);
          } catch (e) {
            if (typeof console !== 'undefined' && console.warn) {
              console.warn('[i18n] vars', e.message);
            }
          }
        }
        const val = this.t(key, vars);
        if (el.tagName === 'TITLE') {
          if (typeof document !== 'undefined') document.title = val;
        } else {
          el.textContent = val;
        }
      });
      r.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
        const key = el.getAttribute('data-i18n-placeholder');
        if (key) el.setAttribute('placeholder', this.t(key));
      });
      r.querySelectorAll('[data-i18n-title]').forEach((el) => {
        const key = el.getAttribute('data-i18n-title');
        if (key) el.setAttribute('title', this.t(key));
      });
      r.querySelectorAll('[data-i18n-aria]').forEach((el) => {
        const key = el.getAttribute('data-i18n-aria');
        if (key) el.setAttribute('aria-label', this.t(key));
      });
      r.querySelectorAll('select[data-i18n-options] option').forEach((opt) => {
        const key = opt.getAttribute('data-i18n');
        if (key) opt.textContent = this.t(key);
      });
    },
    applyYtModeButtons() {
      const map = [
        ['yt-input-search', 'ytModeSearch'],
        ['yt-input-link', 'ytModeLink'],
        ['yt-mode-smart', 'ytFeedSmart'],
        ['yt-mode-history', 'ytFeedHistory'],
      ];
      map.forEach(([id, key]) => {
        const el = document.getElementById(id);
        if (!el) return;
        const span = el.querySelector('span:last-of-type');
        if (span) span.textContent = this.t(key);
      });
    },
    applyTvCategorySelect() {
      const sel = document.getElementById('tv-category-select');
      if (!sel) return;
      const keys = ['tvCatAll', 'tvCatNews', 'tvCatNational', 'tvCatDocumentary', 'tvCatKids', 'tvCatMusic', 'tvCatSports'];
      const vals = ['all', 'haber', 'ulusal', 'belgesel', 'cocuk', 'muzik', 'spor'];
      Array.from(sel.options).forEach((opt, i) => {
        if (keys[i]) opt.textContent = this.t(keys[i]);
        if (vals[i]) opt.value = vals[i];
      });
    },
    applyNavModeSelect() {
      const sel = document.getElementById('nav-mode');
      if (!sel) return;
      const keys = ['navModeDriving', 'navModeWalking', 'navModeBicycle', 'navModeTransit'];
      const vals = ['driving', 'walking', 'bicycling', 'transit'];
      Array.from(sel.options).forEach((opt, i) => {
        if (keys[i]) opt.textContent = this.t(keys[i]);
        if (vals[i]) opt.value = vals[i];
      });
    },
  };

  global.AppI18n = AppI18n;
})(typeof window !== 'undefined' ? window : this);
