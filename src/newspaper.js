/**
 * The Calcutta Chronicle (কলিকাতা ক্রনিকল)
 * Interactive vintage Kolkata broadsheet newspaper bought at A.H. Wheeler (Howrah Station).
 * Procedurally generates authentic news, sports, civic debates, weather, market rates, and satire.
 * The front page also carries today's real Kolkata headlines from /api/news (Google News,
 * headlines and links only); without them the paper is all our own correspondents.
 */

const NEWS_URL = `${import.meta.env.BASE_URL}api/news`;
const LIVE_TTL = 10 * 60 * 1000; // ask the city desk again after ten minutes

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const safeLink = (u) => (/^https?:\/\//.test(u) ? esc(u) : '#');
function ago(t) {
  if (!t) return '';
  const m = Math.max(1, Math.round((Date.now() - t) / 60000));
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} hr${h > 1 ? 's' : ''} ago` : `${Math.round(h / 24)} d ago`;
}

const LEAD_STORIES = [
  {
    category: '⚽ SPORTING INTELLIGENCE · যুবভারতী ক্রীড়াঙ্গন',
    bnHeadline: 'ইস্টবেঙ্গল বনাম মোহনবাগান মহারণে কাঁপছে কলকাতা',
    enHeadline: 'HIGH DRAMA AT YUVA BHARATI: MARINERS & RED-AND-GOLD LOCK HORNS IN ELECTRIFYING 2-2 DRAW',
    subdeck: 'Stoppage-time header sparks wild scenes in Salt Lake; fish markets from Gariahat to Shyambazar report midnight bidding wars for Ilish and Golda Chingri.',
    dropcap: 'B',
    paras: [
      'efore a capacity crowd of eighty-five thousand roaring supporters at Salt Lake Stadium yesterday evening, the historic Kolkata Derby concluded in a breathtaking 2-2 stalemate that will fuel adda debates across north and south Kolkata for months to come.',
      'Mohun Bagan struck first in the twenty-second minute through a blistering thirty-yard free kick that left the goalkeeper stranded, sending the green-and-maroon gallery into ecstasy. East Bengal answered before the lemon break with two clinical counter-attacks, orchestrating waves of red-and-gold smoke across the stands. With seconds remaining in stoppage time, a dramatic corner-kick scramble saw the Mariners equalize, preserving honors on both sides.',
      'Immediately following the final whistle, fish vendors at Maniktala and Gariahat reported soaring demand. "Hilsa from the Padma has reached eighteen hundred rupees a kilo, while jumbo prawns are completely sold out," remarked one breathless vendor. Kolkata Police deployed extra patrol vans across the EM Bypass, but reported only spirited singing and sweets being distributed along the tram tracks.'
    ]
  },
  {
    category: '🚋 CIVIC & HERITAGE AFFAIRS · ঐতিহ্যবাহী ট্রাম',
    bnHeadline: 'শহরের রাজপথে ট্রাম বাঁচাতে এসপ্ল্যানেডে গণবিক্ষোভ',
    enHeadline: 'CITIZENS RALLY AT ESPLANADE TO DEFEND CENTURY-OLD WOODEN TRAMS',
    subdeck: 'Heritage enthusiasts and daily commuters form human chain along Route 36; CTC motorman declares: "A Kolkata without the tram’s foot-gong is a city without its soul."',
    dropcap: 'H',
    paras: [
      'undreds of university students, professors, and veteran daily commuters assembled yesterday outside the Calcutta Tramways Company depot at Esplanade to protest the proposed curtailment of historic wooden tram routes linking Shyambazar, College Street, and the Maidan.',
      'Carrying hand-painted placards reading "Slow Down and Breathe: Save Our Trams", protestors boarded Tram Car No. 142 in symbolic celebration of Asia’s oldest surviving electric tram network. Commuters pointed out that while yellow taxis and app cabs rush through congested lanes, the rhythmic double-clang of the tram’s brass foot-bell remains Kolkata’s most civilized mode of transit.',
      'Transport Department officials confirmed that talks are underway to introduce heritage evening tram services with rooftop tea kiosks and acoustic rabindrasangeet recitals. For now, the wooden cars will continue to rattle peacefully under the ancient banyan trees of the Maidan.'
    ]
  },
  {
    category: '🚇 METROPOLITAN TRANSIT · গঙ্গার নিচে মেট্রো',
    bnHeadline: 'গঙ্গার ৩২ মিটার নিচে ছুটছে মেট্রো: রেকর্ড যাত্রী ভিড়',
    enHeadline: 'HOWRAH UNDERWATER METRO SHATTERS TRANSIT RECORDS AS COMMUTE DROPS TO 45 SECONDS',
    subdeck: 'Passengers gaze in wonder as air-conditioned rakes plunge 32 metres beneath the riverbed silt; Ferry launches at Babu Ghat report business steady among river romantics.',
    dropcap: 'T',
    paras: [
      'he Green Line underwater metro passage linking Howrah Railway Terminus to Mahakaran across the Hooghly River crossed the milestone of two hundred thousand daily commuters yesterday, drastically reshaping cross-river travel across the metropolitan area.',
      'What once took forty-five minutes of bumper-to-bumper crawling across the Howrah Bridge now transpires in a silent, air-conditioned rush of forty-five seconds beneath the riverbed. Commuters reported lighthearted moments inside the coaches as passengers clapped when the automated announcement chimed: "You are now travelling beneath the holy river Ganga."',
      'Ferry launch boatmen at Howrah and Fairlie Ghats remain unfazed by their high-speed subterranean rival. "The Metro gives speed, babu, but can it give the morning river breeze or a clay cup of hot cha watching Howrah Bridge emerge from the morning mist?" smiled launch master Sukumar Das, adjusting his wooden helm.'
    ]
  },
  {
    category: '🌧️ MONSOON WATCH · বর্ষার কলকাতা',
    bnHeadline: 'তুমুল বর্ষণে ভাসছে ঠনঠনিয়া ও কলেজ স্ট্রিট',
    enHeadline: 'CLOUDBURST INUNDATES THANTHANIA: COLLEGE STREET TURNS INTO VENETIAN WATERWAY',
    subdeck: 'Over 95 mm of rain recorded in 90 minutes; Students row makeshift book-cart rafts outside Coffee House as yellow taxis wade like yellow submarines.',
    dropcap: 'A',
    paras: [
      'thunderous monsoon squall breaking over central and north Kolkata transformed College Street, Amherst Street, and Thanthania Kalibari into picturesque urban waterways yesterday afternoon, testing both the drainage pumps and the philosophical humor of Kolkatans.',
      'Trams paused gracefully along submerged tracks while motormen sipped piping hot cha from footboards. Outside the Coffee House, students were seen maneuvering wooden book-crates across knee-deep water while debating existential philosophy. Drivers of Kolkata’s venerable Ambassador yellow taxis earned spontaneous applause as their cars navigated waterlogged streets with exhausts sputtering bravely above the tide.',
      'The Alipore Meteorological Centre predicts intermittent thunder-showers through tomorrow evening. Citizens are advised to carry sturdy umbrellas, beware of splashing buses, and avoid standing beneath old tamarind trees on the Maidan.'
    ]
  },
  {
    category: '🪔 ARTS & TRADITION · কুমোরটুলির সৃষ্টি',
    bnHeadline: 'পুজোর প্রস্তুতি তুঙ্গে: কুমোরটুলিতে মৃৎশিল্পীদের রাতজাগা ব্যস্ততা',
    enHeadline: 'KUMARTULI WORKSHOPS WORK AROUND THE CLOCK AS FESTIVAL MAGIC TAKES SHAPE',
    subdeck: 'Generations of sculptors blend sacred Ganga clay and golden straw; Foreign tourists flock to river alleys to witness the birth of clay deities.',
    dropcap: 'W',
    paras: [
      'ith festival season fast approaching, the narrow labyrinth of Kumartuli along the Hooghly riverbank is alive with the intoxicating scent of wet alluvial clay, fresh straw, and drying natural dyes.',
      'Master sculptors and their apprentices have been working under naked incandescent bulbs until four in the morning to meet commissions from community pandals across Bagbazar, Park Circus, and overseas diaspora committees in London and New Jersey. Traditional "Daker Saaj" silver foil embellishments are seeing a massive resurgence this season.',
      '"No matter how modern the city becomes, the earth of the Ganga and the hands of our artisans remain unchanged for two centuries," noted octogenarian sculptor Ramesh Pal. Community committees have confirmed eco-friendly water-soluble paints will be used to safeguard river dolphins.'
    ]
  }
];

const SECONDARY_STORIES = [
  {
    bnHeadline: 'কফি হাউসের বিতর্ক গড়াল চতুর্থ দিনে',
    enHeadline: 'COFFEE HOUSE DEBATE ENTERS FOURTH CONSECUTIVE DAY WITHOUT CONCLUSION',
    text: 'Table 14 at College Street Coffee House witnessed unbroken philosophical dispute regarding French New Wave cinema and Mohun Bagan’s midfield formation. Over eighteen pots of infusion coffee and forty platefuls of mutton cutlets were consumed. The dispute is expected to resume tomorrow morning at 10 AM sharp.'
  },
  {
    bnHeadline: 'হাওড়া ব্রিজে নতুন আলোর ছটা: প্রিন্সেপ ঘাটে ভিড়',
    enHeadline: 'NEW CANTILEVER ILLUMINATION ON HOWRAH BRIDGE DRAWS THOUSANDS TO RIVER GHATS',
    text: 'The iconic steel cantilever structure was illuminated in brilliant hues of violet, cyan, and amber last night, transforming the Hooghly into a shimmering mirror. Amateur photographers and evening strollers packed Prinsep and Babu Ghats until midnight.'
  },
  {
    bnHeadline: 'স্বেচ্ছায় শিয়ালদহ যেতে রাজি ট্যাক্সিচালক: নাগরিক মহলে বিস্ময়',
    enHeadline: 'YELLOW TAXI PASSENGERS REPORT MYSTERIOUS CABBIE WHO VOLUNTARILY AGREED TO GO TO SEALDAH',
    text: 'Eyewitnesses at Howrah Station describe an Ambassador taxi driver who looked at a commuter, smiled, flagged down his meter, and said "Cholun Dada" without hesitation. The incident has been submitted to the Asiatic Society for urgent verification.'
  },
  {
    bnHeadline: 'বৃষ্টির মধ্যেও কলেজ স্ট্রিটে রেকর্ড বই বিক্রি',
    enHeadline: 'COLLEGE STREET BOI-PARA SETS RECORD BOOK SALES DESPITE MONSOON SPLASHES',
    text: 'Over forty thousand second-hand volumes exchanged hands along pavement stalls between Presidency College and Calcutta University yesterday. A first-edition 1912 collection of poems was discovered beneath a tarpaulin awning.'
  },
  {
    bnHeadline: 'ইডেন গার্ডেন্সে টেস্ট ম্যাচের টিকিট নিয়ে তুমুল কাড়াকাড়ি',
    enHeadline: 'RECORD TICKET CRUSH AT EDEN GARDENS AS CRICKET FEVER GRIPS THE MAIDAN',
    text: 'Queues stretching three kilometres formed outside the Club House gates at daybreak. Local samosa and lemon-tea vendors reported historic business while fans debated bowling strategies along Red Road.'
  }
];

const DADA_CARTOONS = [
  {
    title: "দাদার ঠেক · DADA'S DIALOGUE",
    quoteBn: 'পথচারী: "দাদা, ভিক্টোরিয়া মেমোরিয়াল কোন দিকে?"\nবেঞ্চের ভদ্রলোক: "আপনি যেদিকে মুখ করে দাঁড়িয়ে আছেন, ঠিক তার উল্টো দিকে! কিন্তু এখন যাবেন না, বিকেলবেলার হাওয়া এখানেই ভালো।"',
    quoteEn: 'Passerby: "Dada, which way is Victoria Memorial?"\nGentleman on bench: "Directly opposite to where you are facing! But do not go now—the afternoon breeze is much finer right here."'
  },
  {
    title: "দাদার ঠেক · CABS & PHILOSOPHY",
    quoteBn: 'যাত্রী: "দাদা, শ্যামবাজার যাবেন?"\nট্যাক্সিওয়ালা: "না।"\nযাত্রী: "তাহলে গাড়িতে ‘TAXI’ লেখা কেন?"\nট্যাক্সিওয়ালা: "বাবু, জুতো দোকানে কি সব জুতো আপনার পায়ে লাগে? প্রতি গাড়ির একটা নিজস্ব গন্তব্য আছে!"',
    quoteEn: 'Passenger: "Dada, will you go to Shyambazar?"\nCabbie: "No."\nPassenger: "Then why does the sign on the roof say TAXI?"\nCabbie: "Babu, does every shoe in the shop fit your foot? Every car has its own destiny!"'
  },
  {
    title: "দাদার ঠেক · THE MONSOON COMMUTE",
    quoteBn: 'ছেলে: "বাবা, রাস্তায় এক হাঁটু জল! স্কুলে কি করে যাব?"\nবাবা: "বইয়ের ব্যাগ মাথায় তোলো আর সাঁতার কাটো! আমাদের আমলে এই ঠনঠনিয়ায় কুমির সাঁতার কাটতো!"',
    quoteEn: 'Son: "Father, there is knee-deep water on the road! How do I go to school?"\nFather: "Put the book satchel on your head and swim! In our days at Thanthania, real crocodiles swam through these lanes!"'
  },
  {
    title: "দাদার ঠেক · TEA IN A BHAR",
    quoteBn: 'গ্রাহক: "দাদা, চায়ের সাথে বিস্কুট নেই?"\nদোকানী: "মাটির ভাঁড়ের চায়ে বিস্কুট ডুবিয়ে খাওয়া মানে শিল্পকে অপমান করা, বাবু! চোখ বন্ধ করে চুমুক দিন!"',
    quoteEn: 'Customer: "Dada, don\'t you have biscuits with the tea?"\nTea Vendor: "Dipping a biscuit into clay bhar tea is an insult to fine art, sir! Close your eyes and sip the earthen fragrance!"'
  }
];

const CLASSIFIEDS = [
  {
    tag: 'MATRIMONIAL',
    text: 'Wanted: Cultured, fish-eating groom for convent-educated girl from Ballygunge. Must appreciate Rabindrasangeet and have zero desire to relocate to Bangalore.'
  },
  {
    tag: 'SITUATION VACANT',
    text: 'Conductor required for private bus Route 206. Must be capable of hanging from doorway by one toe while shouting "Shyambazar-Dharmatala-Howrah" at 180 words per minute.'
  },
  {
    tag: 'LOST & FOUND',
    text: 'Black folding umbrella with carved wooden duck handle left on Tram No. 24 between Wellington and Esplanade. Family heirloom from 1952. Finder may keep the rain; return umbrella to A.H. Wheeler.'
  },
  {
    tag: 'ASTROLOGY',
    text: 'Pandit Chakraborty, Gold Medalist (Kalighat): Clear your route through Howrah Bridge traffic gridlock using consecrated planetary gemstones. Guaranteed results within 3 traffic cycles.'
  },
  {
    tag: 'PROPERTY',
    text: 'South-facing 2BHK flat near Kalighat Metro. Continuous corporation water, five minutes from mishti shop. Strictly no brokers or trumpet players.'
  }
];

const LETTERS = [
  {
    title: 'THE DISGRACE OF PAPER CUPS',
    text: 'Sir, — I write with grave consternation regarding the modern youth drinking tea from flimsy paper cups instead of authentic earthen clay bhars. The baked silt of the Gangetic delta imparts an unmistakable mineral sweetness that no paper or plastic can replicate. Are we to abandon our aesthetic heritage for mere disposable convenience? — P.K. Bhattacharya, Retired Headmaster, Ballygunge.'
  },
  {
    title: 'ON FOOTBOARD BRAVERY',
    text: 'Sir, — The reckless velocity at which private buses approach the Howrah Bridge incline is a peril to civic order. Yesterday, a conductor blew his whistle when I possessed only one shoe upon the footboard! When I lodged an objection, he suggested I take an aeroplane. Where is the Traffic Police? — S.N. Banerjee, Beleghata.'
  }
];

export class Newspaper {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.hasBought = false;
    this.editionCount = 0;
    this.seed = Math.floor(Math.random() * 1000);
    this.modalEl = null;
    this.contentEl = null;
    this.live = null; // { updated, en: [...], bn: [...] } from /api/news
    this.liveAt = 0;
    this.liveState = 'idle'; // idle | loading | ok | failed
  }

  /** Today's real headlines; the paper redraws when they arrive. */
  fetchLive() {
    if (this.liveState === 'loading' || (this.live && Date.now() - this.liveAt < LIVE_TTL)) return;
    this.liveState = 'loading';
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 9000);
    fetch(NEWS_URL, { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j || !(j.en?.length || j.bn?.length)) throw new Error('no news');
        this.live = j;
        this.liveAt = Date.now();
        this.liveState = 'ok';
      })
      .catch(() => {
        this.liveState = this.live ? 'ok' : 'failed';
      })
      .finally(() => {
        clearTimeout(timer);
        if (this.active) this.renderEdition();
      });
  }

  /** The real-news column at the top of the front page. */
  liveSection() {
    const en = (this.live && this.live.en) || [];
    if (!en.length) {
      if (this.liveState !== 'loading') return '';
      return `
            <section class="news-live news-live-wait">
              <div class="news-section-tag"><span class="news-live-dot"></span>LIVE FROM THE CITY · আজকের কলকাতা</div>
              <p class="news-live-note">The wire from the city desk is coming in…</p>
            </section>
            <div class="news-ornate-divider">❖ &nbsp; ❖ &nbsp; ❖</div>`;
    }
    const [top, ...rest] = en;
    const meta = (n) => `${esc(n.source || 'Wire')}${n.time ? ` · ${ago(n.time)}` : ''}`;
    const at = new Date(this.live.updated || this.liveAt);
    return `
            <section class="news-live">
              <div class="news-section-tag"><span class="news-live-dot"></span>LIVE FROM THE CITY · আজকের কলকাতা</div>
              <a class="news-live-lead" href="${safeLink(top.link)}" target="_blank" rel="noopener noreferrer">
                <h2 class="news-lead-en-head">${esc(top.title)}</h2>
              </a>
              <div class="news-live-meta">${meta(top)}</div>
              <ol class="news-live-list">
                ${rest
                  .slice(0, 7)
                  .map((n) => `<li><a href="${safeLink(n.link)}" target="_blank" rel="noopener noreferrer">${esc(n.title)}</a><span class="news-live-src">${meta(n)}</span></li>`)
                  .join('')}
              </ol>
              <p class="news-live-note">Today's headlines via Google News · click one to read the full story · wire received ${at.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</p>
            </section>
            <div class="news-ornate-divider">❖ &nbsp; ❖ &nbsp; ❖</div>`;
  }

  /** Bengali headlines for the sidebar. */
  liveBengaliBox() {
    const bn = (this.live && this.live.bn) || [];
    if (!bn.length) return '';
    return `
            <div class="news-box news-box-live-bn">
              <div class="news-box-title">আজকের শিরোনাম · TODAY IN BENGALI</div>
              <ul class="news-live-bn-list">
                ${bn
                  .slice(0, 6)
                  .map((n) => `<li><a href="${safeLink(n.link)}" target="_blank" rel="noopener noreferrer">${esc(n.title)}</a><span class="news-live-src">${esc(n.source || '')}</span></li>`)
                  .join('')}
              </ul>
            </div>`;
  }

  initUI() {
    this.modalEl = document.getElementById('newspaper-modal');
    if (!this.modalEl) return;
    this.contentEl = document.getElementById('newspaper-content');

    const closeBtn = document.getElementById('newspaper-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.close();
      });
    }

    const buyNewBtn = document.getElementById('newspaper-buy-new');
    if (buyNewBtn) {
      buyNewBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.buyAnotherEdition();
      });
    }

    // Clicking outer backdrop closes the paper
    this.modalEl.addEventListener('click', (e) => {
      if (e.target === this.modalEl) {
        this.close();
      }
    });

    // Wire up pause menu button if present
    const pauseBtn = document.getElementById('pause-newspaper');
    if (pauseBtn) {
      pauseBtn.addEventListener('click', () => {
        if (this.game.setPaused) this.game.setPaused(false);
        this.open();
      });
    }
  }

  /** Player bought paper at A.H. Wheeler (₹5) */
  buyAndOpen() {
    this.hasBought = true;
    this.editionCount++;
    this.seed = (this.seed + 137 + Math.floor(Math.random() * 50)) % 10000;

    const pauseBtn = document.getElementById('pause-newspaper');
    if (pauseBtn) pauseBtn.classList.remove('hidden');

    this.open();

    if (this.game.hud) {
      this.game.hud.notify('THE CALCUTTA CHRONICLE', 'Morning Broadsheet · Press ESC to fold & close', '#ffffff');
    }
    if (this.game.progress) {
      this.game.progress.event('newspaper');
    }
  }

  /** Buy a fresh edition inside the open paper modal */
  buyAnotherEdition() {
    if (!this.game || !this.game.gameplay) return;
    if (this.game.gameplay.money < 5) {
      if (this.game.hud) this.game.hud.notify('INSUFFICIENT FARE', 'A fresh edition costs ₹5', '#ff5f6d');
      if (this.game.audio) this.game.audio.beep(false);
      return;
    }
    this.game.gameplay.addMoney(-5);
    if (this.game.audio) {
      this.game.audio.beep(true);
      if (this.game.audio.paperRustle) this.game.audio.paperRustle();
    }
    this.editionCount++;
    this.seed = (this.seed + 271) % 10000;
    this.fetchLive();
    this.renderEdition();
  }

  /** Procedurally assemble today's broadsheet based on current seed and weather */
  generateEditionData() {
    const s = this.seed;
    const lead = LEAD_STORIES[s % LEAD_STORIES.length];
    const sec1 = SECONDARY_STORIES[(s + 1) % SECONDARY_STORIES.length];
    const sec2 = SECONDARY_STORIES[(s + 3) % SECONDARY_STORIES.length];
    const cartoon = DADA_CARTOONS[s % DADA_CARTOONS.length];
    const letter = LETTERS[s % LETTERS.length];

    // Pick 3 classifieds
    const classList = [
      CLASSIFIEDS[s % CLASSIFIEDS.length],
      CLASSIFIEDS[(s + 2) % CLASSIFIEDS.length],
      CLASSIFIEDS[(s + 4) % CLASSIFIEDS.length]
    ];

    // Live weather integration if available
    let wxSummary = 'SUNNY & BREEZY · 31°C';
    let wxTides = 'Ganga High Tide (Prinsep Ghat): 05:42 & 18:10 · Moon: Waxing';
    if (this.game.weather && this.game.weather.summary) {
      const w = this.game.weather.summary;
      const t = w.temp ? `${Math.round(w.temp)}°C` : '30°C';
      const cond = w.text ? w.text.toUpperCase() : 'CLEAR';
      wxSummary = `${cond} · ${t}`;
      if (w.rain > 0.1) {
        wxTides = 'Monsoon Alert: High Tide 06:15 & 18:45 · Heavy Hooghly Surge';
      }
    }

    // Format date string
    const now = new Date();
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const dateStr = `${dayNames[now.getDay()]}, ${now.getDate()} ${monthNames[now.getMonth()]} ${now.getFullYear()}`;
    const volNum = 130 + (now.getFullYear() - 2020);
    const issueNum = 100 + (now.getDate() * 7 + (s % 50));

    return {
      lead,
      sec1,
      sec2,
      cartoon,
      letter,
      classList,
      wxSummary,
      wxTides,
      dateStr,
      volNum,
      issueNum,
      editionCount: this.editionCount
    };
  }

  renderEdition() {
    if (!this.contentEl) return;
    const data = this.generateEditionData();

    this.contentEl.innerHTML = `
      <article class="broadsheet-paper">
        <!-- TOP DECORATIVE HEADER -->
        <header class="news-top-banner">
          <div class="news-ear news-ear-left">
            <span class="ear-title">THE CALCUTTA CHRONICLE</span>
            <span class="ear-sub">BENGAL'S DAILY BROADSHEET</span>
            <span class="ear-est">ESTABLISHED 1888</span>
            <span class="ear-motto">সত্যমেব জয়তে</span>
          </div>

          <div class="news-masthead-center">
            <div class="news-bn-title">কলিকাতা ক্রনিকল</div>
            <h1 class="news-main-title">THE CALCUTTA CHRONICLE</h1>
            <div class="news-latin-motto">❖ VERITAS ET LIBERTAS · VOICE OF THE CITY OF JOY · LARGEST CIRCULATION IN BENGAL ❖</div>
          </div>

          <div class="news-ear news-ear-right">
            <span class="ear-title">WEATHER &amp; TIDES</span>
            <span class="ear-wx-val">${data.wxSummary}</span>
            <span class="ear-tide">${data.wxTides}</span>
          </div>
        </header>

        <!-- DATELINE BAR -->
        <div class="news-dateline-bar">
          <div class="nd-left">VOL. ${data.volNum} NO. ${data.issueNum} · REGD. NO. C-1888</div>
          <div class="nd-center">KOLKATA, ${data.dateStr.toUpperCase()} · MORNING FINAL EDITION</div>
          <div class="nd-right">PRICE: ₹5.00 · FIVE ANNAS</div>
        </div>

        <!-- MAIN BROADSHEET CONTENT GRID -->
        <div class="news-body-grid">
          <!-- LEFT / MAIN COLUMN (Lead Story + Secondary Story) -->
          <div class="news-main-col">
            <!-- TODAY'S REAL HEADLINES -->
            ${this.liveSection()}

            <!-- LEAD STORY -->
            <section class="news-lead-story">
              <div class="news-section-tag">${data.lead.category}</div>
              <h2 class="news-lead-bn-head">${data.lead.bnHeadline}</h2>
              <h3 class="news-lead-en-head">${data.lead.enHeadline}</h3>
              <div class="news-lead-deck">${data.lead.subdeck}</div>

              <div class="news-lead-columns">
                <p><span class="news-dropcap">${data.lead.dropcap}</span>${data.lead.paras[0]}</p>
                <p>${data.lead.paras[1]}</p>
                <p>${data.lead.paras[2]}</p>
              </div>
            </section>

            <div class="news-ornate-divider">❖ &nbsp; ❖ &nbsp; ❖</div>

            <!-- SECONDARY STORIES (TWO ACROSS) -->
            <div class="news-two-col-stories">
              <article class="news-sub-story">
                <div class="news-sub-bn-head">${data.sec1.bnHeadline}</div>
                <h4 class="news-sub-en-head">${data.sec1.enHeadline}</h4>
                <p class="news-sub-text">${data.sec1.text}</p>
              </article>

              <article class="news-sub-story">
                <div class="news-sub-bn-head">${data.sec2.bnHeadline}</div>
                <h4 class="news-sub-en-head">${data.sec2.enHeadline}</h4>
                <p class="news-sub-text">${data.sec2.text}</p>
              </article>
            </div>
          </div>

          <!-- RIGHT / SIDEBAR COLUMN (Cartoon + Market Rates + Classifieds + Letters) -->
          <aside class="news-sidebar-col">
            ${this.liveBengaliBox()}

            <!-- DADA'S CORNER POCKET CARTOON & DIALOGUE -->
            <div class="news-box news-box-cartoon">
              <div class="news-box-title">${data.cartoon.title}</div>
              <div class="news-cartoon-dialogue">
                <div class="ncd-bn">${data.cartoon.quoteBn.replace(/\n/g, '<br>')}</div>
                <div class="ncd-sep">✦ &nbsp; ✦ &nbsp; ✦</div>
                <div class="ncd-en">${data.cartoon.quoteEn.replace(/\n/g, '<br>')}</div>
              </div>
            </div>

            <!-- ROSOGOLLA & COMMODITY INDEX -->
            <div class="news-box news-box-rates">
              <div class="news-box-title">COMMERCIAL INTELLIGENCE · বাজার দর</div>
              <table class="news-rates-table">
                <tbody>
                  <tr><td>K.C. Das Sponge Rosogolla (Tin of 12)</td><td class="rate-val">₹300</td></tr>
                  <tr><td>Nolen Gur Sandesh (Per piece)</td><td class="rate-val">₹35</td></tr>
                  <tr><td>Padma River Ilish (1.2 kg grade)</td><td class="rate-val">₹1,850/kg</td></tr>
                  <tr><td>Golda Chingri (Giant Freshwater Prawns)</td><td class="rate-val">₹920/kg</td></tr>
                  <tr><td>Clay Bhar Cha (Howrah Concourse)</td><td class="rate-val">₹5.00</td></tr>
                  <tr><td>Darjeeling First Flush (100g)</td><td class="rate-val">₹420</td></tr>
                  <tr><td>Kolkata Yellow Taxi Flag-Down Fare</td><td class="rate-val">₹30.00</td></tr>
                  <tr><td>Ganga Ferry Ticket (Howrah to Fairlie)</td><td class="rate-val">₹6.00</td></tr>
                  <tr><td>Gold Sovereign (24 Karat 10g)</td><td class="rate-val">₹76,400</td></tr>
                </tbody>
              </table>
            </div>

            <!-- CLASSIFIEDS -->
            <div class="news-box news-box-classifieds">
              <div class="news-box-title">CLASSIFIED ADVERTISEMENTS · বিজ্ঞাপন</div>
              <div class="news-classified-items">
                ${data.classList.map((c) => `
                  <div class="classified-item">
                    <span class="cl-tag">${c.tag}:</span>
                    <span class="cl-text">${c.text}</span>
                  </div>
                `).join('')}
              </div>
            </div>

            <!-- LETTERS TO THE EDITOR -->
            <div class="news-box news-box-letter">
              <div class="news-box-title">TO THE EDITOR · চিঠিপত্র</div>
              <div class="letter-title">${data.letter.title}</div>
              <p class="letter-text">${data.letter.text}</p>
            </div>
          </aside>
        </div>

        <!-- BROADSHEET FOOTER -->
        <footer class="news-footer-bar">
          <div class="nf-col">Printed &amp; Published by A.H. Wheeler &amp; Co., Howrah Railway Terminus, Concourse Stall No. 3.</div>
          <div class="nf-col">Regd. with Registrar of Newspapers for India under No. WB/CAL/1888. All rights reserved.</div>
          <div class="nf-col">Press <b>ESC</b> or Click Close to fold paper.</div>
        </footer>
      </article>
    `;
  }

  open() {
    if (!this.modalEl) this.initUI();
    if (!this.modalEl) return;

    this.active = true;
    this.fetchLive();
    this.renderEdition();
    this.modalEl.classList.remove('hidden');

    if (this.game && this.game.setNewspaper) {
      this.game.setNewspaper(true);
    }
    if (this.game && this.game.audio && this.game.audio.paperRustle) {
      this.game.audio.paperRustle();
    }
  }

  close() {
    if (!this.modalEl) return;
    this.active = false;
    this.modalEl.classList.add('hidden');

    if (this.game && this.game.setNewspaper) {
      this.game.setNewspaper(false);
    }
    if (this.game && this.game.audio && this.game.audio.paperRustle) {
      this.game.audio.paperRustle();
    }
  }
}
