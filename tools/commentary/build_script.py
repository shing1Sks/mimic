"""Writes script.json: Paaji's lines. Original, written for Willowlight (2026-11-14).
Each row: Latin-script Hinglish (subtitles) | Devanagari with English cricket words (what the voice says).
Run: python tools/commentary/build_script.py"""
import json, os
HERE = os.path.dirname(os.path.abspath(__file__))
M = {}  # moment -> (prio, delivery note, [(latin, devanagari)])


def m(name, prio, note, rows):
    M[name] = (prio, note, [tuple(x.strip() for x in r.split('|')) for r in rows.strip().splitlines()])


m('six', 3, 'build up with a grin, then explode with joy and roar the payoff', '''
Oye hoye! Yeh gend nahi, guided missile thi, seedha stands mein! | ओए होए! ये गेंद नहीं, guided missile थी, सीधा stands में!
Batsman ne aise maara, jaise dhobi kapde dhota hai... dho daala! | बल्लेबाज़ ने ऐसे मारा, जैसे धोबी कपड़े धोता है... धो डाला!
Balle balle! Chhakka! Gend gayi chaand ki sair pe! | बल्ले बल्ले! छक्का! गेंद गई चाँद की सैर पे!
Uda diya! Jaise patang kat ke aasmaan mein chali jaaye! | उड़ा दिया! जैसे पतंग कट के आसमान में चली जाए!
Yeh shot nahi tha guru, yeh toh shaadi ka band baaja tha! Chhakka! | ये shot नहीं था गुरु, ये तो शादी का बैंड बाजा था! छक्का!
Gend ne ticket kaata, aur seedha crowd ke beech jaa baithi! | गेंद ने ticket काटा, और सीधा crowd के बीच जा बैठी!
Oye mere sher! Kya maara hai, kya maara hai! | ओए मेरे शेर! क्या मारा है, क्या मारा है!
Bowler soch raha tha yorker daalunga, batsman ne usse lassi bana ke pee liya! | Bowler सोच रहा था yorker डालूँगा, बल्लेबाज़ ने उसे लस्सी बना के पी लिया!
Chak de phatte! Chhe run, aur stadium hil gaya! | चक दे फट्टे! छह रन, और stadium हिल गया!
Gend ko passport chahiye tha, itni door gayi hai! | गेंद को passport चाहिए था, इतनी दूर गई है!
Aisa maara jaise tandoor se garam roti nikli ho... seedha boundary paar! | ऐसा मारा जैसे तंदूर से गरम रोटी निकली हो... सीधा boundary पार!
Bowler ki line, batsman ki mehfil! Chhakka! | Bowler की line, बल्लेबाज़ की महफ़िल! छक्का!
Upar, upar, aur upar... gayi! Bye bye gend! | ऊपर, ऊपर, और ऊपर... गई! Bye bye गेंद!
Oye hoye! Isko kehte hain bat se kavita likhna! | ओए होए! इसको कहते हैं bat से कविता लिखना!
''')
m('four', 2, 'punchy and delighted, a quick laugh in the voice', '''
Chaar run! Gend aise bhaagi jaise ghar pe biryani bani ho! | चार रन! गेंद ऐसे भागी जैसे घर पे बिरयानी बनी हो!
Gap dhoondha, aur gap mein ghus gaya! Four! | Gap ढूँढा, और gap में घुस गया! Four!
Fielder dekhta reh gaya, gend boundary chhoo gayi! | Fielder देखता रह गया, गेंद boundary छू गई!
Kya timing hai guru! Makhan mein chhuri! | क्या timing है गुरु! मक्खन में छुरी!
Saanp ki tarah sarakti hui, seedha rope tak! | साँप की तरह सरकती हुई, सीधा rope तक!
Chauka! Aur fielder ki saans phool gayi! | चौका! और fielder की साँस फूल गई!
Oye! Yeh toh express train thi, koi station nahi ruki! | ओए! ये तो express train थी, कोई station नहीं रुकी!
Boundary pe dastak di, darwaza khul gaya! Four! | Boundary पे दस्तक दी, दरवाज़ा खुल गया! Four!
Shot mein itni class, jaise suit pehen ke khel raha ho! | Shot में इतनी class, जैसे suit पहन के खेल रहा हो!
Chaar run, aur bowler ke chehre pe baarah baj gaye! | चार रन, और bowler के चेहरे पे बारह बज गए!
Dhaage ki tarah seedha! Chauka! | धागे की तरह सीधा! चौका!
Gend ko GPS laga ke bheja hai, seedha gap mein! | गेंद को GPS लगा के भेजा है, सीधा gap में!
''')
m('edgeFour', 2, 'laughing in disbelief', '''
Haha! Kismat ka chauka! Edge laga aur gend nikal gayi! | हाहा! किस्मत का चौका! Edge लगा और गेंद निकल गई!
Bat ka kona, aur chaar run! Upar waala meherbaan! | Bat का कोना, और चार रन! ऊपर वाला मेहरबान!
Thick edge, thick luck! Four! | Thick edge, thick luck! Four!
Isko kehte hain jugaad ka chauka! | इसको कहते हैं जुगाड़ का चौका!
Gend ne bat ko chhua, aur bhaag gayi slips ke beech se! | गेंद ने bat को छुआ, और भाग गई slips के बीच से!
''')
m('dot', 1, 'calm and wry, a knowing smile', '''
Koi run nahi. Bowler ne taala laga diya. | कोई run नहीं। Bowler ने ताला लगा दिया।
Dot ball. Shaanti, shaanti. | Dot ball. शांति, शांति।
Rok diya. Deewar ki tarah khada hai. | रोक दिया। दीवार की तरह खड़ा है।
Kuch nahi hua... toofan se pehle ki khamoshi. | कुछ नहीं हुआ... तूफ़ान से पहले की ख़ामोशी।
Achhi gend, achha defence. Barabar ki takkar. | अच्छी गेंद, अच्छा defence. बराबर की टक्कर।
Dot! Bowler muskura raha hai. | Dot! Bowler मुस्कुरा रहा है।
Bat neeche, gend wahin. Koi run nahi. | Bat नीचे, गेंद वहीं। कोई run नहीं।
Ek aur khaali gend. Pressure badh raha hai, guru. | एक और खाली गेंद। Pressure बढ़ रहा है, गुरु।
''')
m('beaten', 1, 'a sharp gasp, then admiring', '''
Oye! Beaten! Gend aur bat mein do kilometre ka faasla! | ओए! Beaten! गेंद और bat में दो किलोमीटर का फ़ासला!
Chhoo ke nikal gayi, jaise pehla pyaar! | छू के निकल गई, जैसे पहला प्यार!
Kya gend hai! Batsman ko pata hi nahi chala. | क्या गेंद है! बल्लेबाज़ को पता ही नहीं चला।
Outside edge ko salaam karke nikal gayi! | Outside edge को सलाम करके निकल गई!
Bat ghuma diya, gend ne haath hila diya! | Bat घुमा दिया, गेंद ने हाथ हिला दिया!
Itni swing, jaise mele ka jhoola! | इतनी swing, जैसे मेले का झूला!
Bach gaya! Aaj kismat saath hai. | बच गया! आज किस्मत साथ है।
''')
m('appeal', 2, 'rising suspense, holding the breath', '''
Zor ki appeal! Poori team chilla rahi hai! | ज़ोर की appeal! पूरी team चिल्ला रही है!
How's that?! Umpire soch rahe hain... | How's that?! Umpire सोच रहे हैं...
Pad pe laga! Kya yeh out hai?! | Pad पे लगा! क्या ये out है?!
Saari duniya ki nazar umpire ki ungli pe! | सारी दुनिया की नज़र umpire की उँगली पे!
Appeal itni zor ki, ki pados ke gaon tak awaaz gayi! | Appeal इतनी ज़ोर की, कि पड़ोस के गाँव तक आवाज़ गई!
''')
m('bowled', 3, 'a dramatic roar, savouring the destruction', '''
Bowled! Danda ukhaad diya! | Bowled! डंडा उखाड़ दिया!
Gilli udd gayi, jaise shaadi mein pataakha! | गिल्ली उड़ गई, जैसे शादी में पटाखा!
Stumps bikhar gaye! Ghar wapas jao, bhaiya! | Stumps बिखर गए! घर वापस जाओ, भैया!
Darwaza khula chhoda, aur chor andar aa gaya! Bowled! | दरवाज़ा खुला छोड़ा, और चोर अंदर आ गया! Bowled!
Oye hoye! Middle stump ne cartwheel maar diya! | ओए होए! Middle stump ने cartwheel मार दिया!
Bat aur pad ke beech se, seedha stumps! Kya gend hai! | Bat और pad के बीच से, सीधा stumps! क्या गेंद है!
Clean bowled! Jaise sabzi kaat di ho! | Clean bowled! जैसे सब्ज़ी काट दी हो!
Timber! Lakdi ka dher laga diya! | Timber! लकड़ी का ढेर लगा दिया!
''')
m('caught', 3, 'excited and dramatic, the payoff shouted', '''
Pakad liya! Haath mein gend, aur gale mein maala! | पकड़ लिया! हाथ में गेंद, और गले में माला!
Upar gayi, neeche aayi, aur seedha jholi mein! Out! | ऊपर गई, नीचे आई, और सीधा झोली में! Out!
Catch! Jaise maa ne garam roti thaali mein rakh di! | Catch! जैसे माँ ने गरम रोटी थाली में रख दी!
Shot toh bada tha, par fielder usse bhi bada nikla! | Shot तो बड़ा था, पर fielder उससे भी बड़ा निकला!
Hawa mein gend... aur pakdi gayi! Bas, khel khatam! | हवा में गेंद... और पकड़ी गई! बस, खेल ख़त्म!
Chhakka maarne chala tha, catch de baitha! | छक्का मारने चला था, catch दे बैठा!
Safe hands! Jaise bank ka locker! | Safe hands! जैसे bank का locker!
Oye! Kya catch hai! Yeh fielder nahi, magnet hai! | ओए! क्या catch है! ये fielder नहीं, magnet है!
Seedha fielder ke haath mein, jaise address likh ke bheja ho! | सीधा fielder के हाथ में, जैसे address लिख के भेजा हो!
Lalach buri bala hai! Caught! | लालच बुरी बला है! Caught!
''')
m('lbw', 3, 'firm, then triumphant', '''
Ungli upar! LBW! Seedha saamne fasa! | उँगली ऊपर! LBW! सीधा सामने फँसा!
Pad pe laga, aur umpire ne faisla suna diya! Out! | Pad पे लगा, और umpire ने फ़ैसला सुना दिया! Out!
Plumb! Jaise taraazu ka kaanta, ekdum seedha! | Plumb! जैसे तराज़ू का काँटा, एकदम सीधा!
LBW! Pair aage kiya, aur fas gaya! | LBW! पैर आगे किया, और फँस गया!
Wicket ke saamne khade the, aur wicket le gayi! | Wicket के सामने खड़े थे, और wicket ले गई!
''')
m('playedOn', 3, 'a groan, sympathetic', '''
Arre! Khud hi stumps pe kheench li! | अरे! ख़ुद ही stumps पे खींच ली!
Andar ka edge, aur apne hi ghar mein aag! | अंदर का edge, और अपने ही घर में आग!
Kismat kharaab! Gend bat se lagi aur stumps ko chhoo gayi. | किस्मत ख़राब! गेंद bat से लगी और stumps को छू गई।
Apne hi pair pe kulhaadi maar li, guru! | अपने ही पैर पे कुल्हाड़ी मार ली, गुरु!
''')
m('dropped', 2, 'agony at first, then laughing at the fielder', '''
Arre arre arre! Chhod diya! Haath mein aayi aur nikal gayi! | अरे अरे अरे! छोड़ दिया! हाथ में आई और निकल गई!
Gend makkhan thi kya? Phisal gayi! | गेंद मक्खन थी क्या? फिसल गई!
Drop! Yeh catch nahi, yeh toh dil tootna tha! | Drop! ये catch नहीं, ये तो दिल टूटना था!
Jeevan daan mil gaya! Ab dekhte hain kya karta hai. | जीवन दान मिल गया! अब देखते हैं क्या करता है।
Haathon mein chhed hai kya, bhai? | हाथों में छेद है क्या, भाई?
Itna aasaan catch, aur zameen pe! Haaye rabba! | इतना आसान catch, और ज़मीन पे! हाय रब्बा!
Gend ne haath se shake-hand kiya aur chali gayi! | गेंद ने हाथ से shake-hand किया और चली गई!
Catches jitwaate hain match, aur yeh toh gira diya! | Catches जितवाते हैं match, और ये तो गिरा दिया!
''')
m('misfield', 2, 'amused, teasing', '''
Fumble! Gend ne fielder ko chakma de diya! | Fumble! गेंद ने fielder को चकमा दे दिया!
Taangon ke beech se! Oye hoye, misfield! | टाँगों के बीच से! ओए होए, misfield!
Fielder jhuka, gend nikal gayi, jaise machhli haath se! | Fielder झुका, गेंद निकल गई, जैसे मछली हाथ से!
Do fielder, ek gend, aur dono ne ek doosre ko dekha! | दो fielder, एक गेंद, और दोनों ने एक दूसरे को देखा!
Extra run ka tohfa! Shukriya, fielder saab! | Extra run का तोहफ़ा! शुक्रिया, fielder साहब!
Gend pakadne gaye the, gend ne unhe pakad liya! | गेंद पकड़ने गए थे, गेंद ने उन्हें पकड़ लिया!
''')
m('sledge', 1, 'cheeky, chuckling', '''
Oho! Aankhon aankhon mein baatein ho rahi hain! | ओहो! आँखों आँखों में बातें हो रही हैं!
Garmaa garmi! Yeh match ab personal ho gaya! | गरमा गरमी! ये match अब personal हो गया!
Bowler ne kuch kaha... batsman ne bat se jawaab diya! | Bowler ने कुछ कहा... बल्लेबाज़ ने bat से जवाब दिया!
Chai mein shakkar kam, maidaan mein mirchi zyaada! | चाय में शक्कर कम, मैदान में मिर्ची ज़्यादा!
Hehe! Thoda masala bhi zaroori hai, guru! | हेहे! थोड़ा मसाला भी ज़रूरी है, गुरु!
''')
m('lastOver', 2, 'tense, voice low then building', '''
Aakhri over! Dil ki dhadkan stadium mein sunai de rahi hai! | आख़िरी over! दिल की धड़कन stadium में सुनाई दे रही है!
Chhe gend, aur saari kahaani baaki! | छह गेंद, और सारी कहानी बाक़ी!
Yahi woh pal hai jahan hero bante hain! | यही वो पल है जहाँ hero बनते हैं!
Nakhoon chabaane ka time aa gaya, doston! | नाख़ून चबाने का time आ गया, दोस्तों!
Aakhri over, aur saans rok ke baitho! | आख़िरी over, और साँस रोक के बैठो!
''')
m('quick20', 3, 'proud, impressed', '''
Kya tez innings hai! Run aise aa rahe hain jaise baarish! | क्या तेज़ innings है! Run ऐसे आ रहे हैं जैसे बारिश!
Yeh batsman aaj rukne waala nahi! | ये बल्लेबाज़ आज रुकने वाला नहीं!
Scoreboard bhaag raha hai, guru! | Scoreboard भाग रहा है, गुरु!
Bowlers ki shaamat aa gayi aaj! | Bowlers की शामत आ गई आज!
''')
m('hatTrick', 4, 'screaming with joy, beside himself', '''
Hat-trick! Teen gend, teen wicket! Itihaas ban gaya! | Hat-trick! तीन गेंद, तीन wicket! इतिहास बन गया!
Oye hoye! Hat-trick! Yeh bowler nahi, jaadugar hai! | ओए होए! Hat-trick! ये bowler नहीं, जादूगर है!
Ek, do, teen! Hat-trick! Stadium paagal ho gaya! | एक, दो, तीन! Hat-trick! Stadium पागल हो गया!
Hat-trick! Aaj toh bowler ke ghar Diwali hai! | Hat-trick! आज तो bowler के घर दिवाली है!
''')
m('threeWickets', 3, 'admiring, a little awed', '''
Teesra wicket! Yeh bowler aaj aag ugal raha hai! | तीसरा wicket! ये bowler आज आग उगल रहा है!
Teen wicket! Batting line-up mein bhookamp! | तीन wicket! Batting line-up में भूकंप!
Ek ke baad ek! Jaise domino gir rahe hain! | एक के बाद एक! जैसे domino गिर रहे हैं!
Teen shikaar! Sher aaj bhookha hai! | तीन शिकार! शेर आज भूखा है!
''')
m('wide', 1, 'dry and amused', '''
Wide! Itni door ki gend, ki pados waale stadium mein jaati. | Wide! इतनी दूर की गेंद, कि पड़ोस वाले stadium में जाती।
Wide ball. Muft ka run, shukriya! | Wide ball. मुफ़्त का run, शुक्रिया!
Line bhatak gayi bowler ki! Wide! | Line भटक गई bowler की! Wide!
Arre, nishaana chook gaya! Wide! | अरे, निशाना चूक गया! Wide!
''')
m('noBall', 2, 'alert, sitting up', '''
No ball! Free hit aa raha hai! | No ball! Free hit आ रहा है!
Pair line ke paar! No ball! | पैर line के पार! No ball!
No ball! Bowler ne galti ki, batsman ki chaandi! | No ball! Bowler ने ग़लती की, बल्लेबाज़ की चाँदी!
Oye! Kamar se upar! No ball! | ओए! कमर से ऊपर! No ball!
''')
m('won', 4, 'an ecstatic victory roar', '''
Jeet gaye! Balle balle! Aaj raat bhangra hoga! | जीत गए! बल्ले बल्ले! आज रात भंगड़ा होगा!
Match khatam, jeet hamari! Chak de phatte! | Match ख़त्म, जीत हमारी! चक दे फट्टे!
Oye hoye! Kya jeet hai! Dil garden garden ho gaya! | ओए होए! क्या जीत है! दिल garden garden हो गया!
Jeet ka swaad, jaise sarson ka saag aur makki di roti! | जीत का स्वाद, जैसे सरसों का साग और मक्की दी रोटी!
Champion! Champion! Poora stadium naach raha hai! | Champion! Champion! पूरा stadium नाच रहा है!
Yeh jeet yaad rakhi jaayegi, doston! | ये जीत याद रखी जाएगी, दोस्तों!
''')
m('lost', 4, 'warm and sympathetic, then rousing', '''
Haar gaye... par sher ki tarah lade! | हार गए... पर शेर की तरह लड़े!
Aaj din unka tha. Kal hamara hoga, guru! | आज दिन उनका था। कल हमारा होगा, गुरु!
Haar jeet toh chalti rehti hai, khel dil se khela! | हार जीत तो चलती रहती है, खेल दिल से खेला!
Thoda sa chooke, bas! Agli baar dho daalenge! | थोड़ा सा चूके, बस! अगली बार धो डालेंगे!
Maidaan mein haare, dil mein nahi! | मैदान में हारे, दिल में नहीं!
''')
m('betweenOvers', 1, 'slow and poetic, savouring every word like a couplet', '''
Cricket ek kavita hai, doston... har gend ek nayi pankti. | Cricket एक कविता है, दोस्तों... हर गेंद एक नई पंक्ति।
Jaise chai bina adrak ke adhoori, waise match bina chhakke ke! | जैसे चाय बिना अदरक के अधूरी, वैसे match बिना छक्के के!
Pitch pe ghaas kam, khiladiyon mein josh zyaada! | Pitch पे घास कम, खिलाड़ियों में जोश ज़्यादा!
Bowler ki mehnat, batsman ki himmat... yahi toh cricket hai! | Bowler की मेहनत, बल्लेबाज़ की हिम्मत... यही तो cricket है!
Khel mein jo darr gaya, samjho woh haar gaya! | खेल में जो डर गया, समझो वो हार गया!
Over khatam, kahaani jaari hai! | Over ख़त्म, कहानी जारी है!
Aasmaan saaf, maidaan hara, aur dil mein toofan! | आसमान साफ़, मैदान हरा, और दिल में तूफ़ान!
Ek over mein zindagi badal jaati hai, guru! | एक over में ज़िंदगी बदल जाती है, गुरु!
''')
m('start', 2, 'a warm, booming welcome', '''
Namaskar, sat sri akal, aur swagat hai! Aaj ka match dhamaakedaar hoga! | नमस्कार, सत श्री अकाल, और स्वागत है! आज का match धमाकेदार होगा!
Stadium bhara hua, josh bhara hua! Shuru karte hain! | Stadium भरा हुआ, जोश भरा हुआ! शुरू करते हैं!
Oye hoye! Kya maahaul hai! Aaj toh chhakke barsenge! | ओए होए! क्या माहौल है! आज तो छक्के बरसेंगे!
Pads pehno, bat uthao, aur ho jao shuru! | Pads पहनो, bat उठाओ, और हो जाओ शुरू!
''')

m('newBatter', 2, 'welcoming the new man in, warm but with a challenge in the voice', '''
Naya khiladi aa raha hai, pads kas ke, dil mazboot karke! | नया खिलाड़ी आ रहा है, pads कस के, दिल मज़बूत करके!
Agla batsman maidaan mein! Dekhte hain iske bat mein kitna dum hai! | अगला batsman मैदान में! देखते हैं इसके bat में कितना दम है!
Chalo bhai, ab tumhari baari! Jahan woh chhod gaya, wahin se uthao! | चलो भाई, अब तुम्हारी बारी! जहाँ वो छोड़ गया, वहीं से उठाओ!
Naya chehra, nayi umeed! Crease pe aao, sher! | नया चेहरा, नई उम्मीद! Crease पे आओ, शेर!
Ek gaya, doosra aaya... cricket ki gaadi rukti nahi, guru! | एक गया, दूसरा आया... cricket की गाड़ी रुकती नहीं, गुरु!
Naya batsman, aur bowler ki aankhon mein chamak! | नया batsman, और bowler की आँखों में चमक!
''')
m('newBowler', 1, 'curious and teasing, sizing up a fresh bowler', '''
Naya gendbaaz, nayi chaal! Dekhte hain kya jaadu hai iski jholi mein! | नया गेंदबाज़, नई चाल! देखते हैं क्या जादू है इसकी झोली में!
Gend badli haath mein, ab khel badlega! | गेंद बदली हाथ में, अब खेल बदलेगा!
Captain ne naya hathiyaar nikaala hai! | Captain ने नया हथियार निकाला है!
Naya bowler aaya hai, aur batsman ne bhi kamar kas li! | नया bowler आया है, और batsman ने भी कमर कस ली!
Ab aayega asli imtehaan... naye haathon mein gend! | अब आएगा असली इम्तिहान... नए हाथों में गेंद!
''')
m('bowlerBack', 1, 'knowing, like greeting an old friend', '''
Yeh phir aa gaya! Pichhli baar ka hisaab baaki hai! | ये फिर आ गया! पिछली बार का हिसाब बाकी है!
Purana khiladi, naya over! Dekhte hain ab kya karta hai! | पुराना खिलाड़ी, नया over! देखते हैं अब क्या करता है!
Wapas aaya hai gendbaaz, nayi soch ke saath! | वापस आया है गेंदबाज़, नई सोच के साथ!
''')
m('bowlerOnFire', 2, 'thrilled and a little scary, this bowler is dangerous', '''
Saavdhaan! Yeh woh gendbaaz hai jisne pehle hi do wicket le liye hain! | सावधान! ये वो गेंदबाज़ है जिसने पहले ही दो wicket ले लिए हैं!
Aag lagi hui hai iski gend mein! Batsman, sambhal ke! | आग लगी हुई है इसकी गेंद में! Batsman, संभल के!
Yeh aadmi aaj shikaar pe nikla hai, guru! | ये आदमी आज शिकार पे निकला है, गुरु!
Wicket ki bhookh iski aankhon mein saaf dikh rahi hai! | Wicket की भूख इसकी आँखों में साफ़ दिख रही है!
''')
m('bowlerExpensive', 1, 'teasing with sympathy, laughing gently', '''
Pichhle over mein isne run aise baante jaise shaadi mein mithaai! | पिछले over में इसने run ऐसे बाँटे जैसे शादी में मिठाई!
Bechaara! Pichhli baar toh pitaai ho gayi thi, ab badla lega? | बेचारा! पिछली बार तो पिटाई हो गई थी, अब बदला लेगा?
Is gendbaaz ki jeb se run aise gire jaise chhed waali balti se paani! | इस गेंदबाज़ की जेब से run ऐसे गिरे जैसे छेद वाली बाल्टी से पानी!
Captain ne phir bharosa kiya hai... ab izzat bachaani hai! | Captain ने फिर भरोसा किया है... अब इज़्ज़त बचानी है!
''')
m('batterSet', 2, 'admiring, building a big crescendo', '''
Yeh batsman aaj gend ko football ki tarah dekh raha hai! | ये batsman आज गेंद को football की तरह देख रहा है!
Tees ke paar! Aaj iska din hai, guru, aaj iska din hai! | तीस के पार! आज इसका दिन है, गुरु, आज इसका दिन है!
Jam gaya hai yeh! Jaise purane bargad ki jadein! | जम गया है ये! जैसे पुराने बरगद की जड़ें!
Bowler kuch bhi daale, yeh sabko mithaai bana raha hai! | Bowler कुछ भी डाले, ये सबको मिठाई बना रहा है!
Is khiladi ki aankh mein aaj baaz ki nazar hai! | इस खिलाड़ी की आँख में आज बाज़ की नज़र है!
''')
m('batterStruggling', 1, 'gently mocking, then encouraging', '''
Bechaare ka bat aaj ruthi hui biwi ki tarah baat nahi kar raha! | बेचारे का bat आज रूठी हुई बीवी की तरह बात नहीं कर रहा!
Run nahi aa rahe, guru! Dil chhota mat karo, ek shot sab badal dega! | Run नहीं आ रहे, गुरु! दिल छोटा मत करो, एक shot सब बदल देगा!
Gend dhoondh raha hai, gend chhup rahi hai! | गेंद ढूँढ रहा है, गेंद छुप रही है!
Itni gendein, itne kam run... kuch toh karo, mere bhai! | इतनी गेंदें, इतने कम run... कुछ तो करो, मेरे भाई!
''')
m('chaseStart', 2, 'dramatic and rousing, the chase is on', '''
Lakshya saamne hai, josh seene mein! Chase shuru! | लक्ष्य सामने है, जोश सीने में! Chase शुरू!
Ab dekhenge kisme hai dum! Target ka peechha shuru! | अब देखेंगे किसमें है दम! Target का पीछा शुरू!
Pehli paari khatam, kahaani ka asli mod ab aayega! | पहली पारी ख़त्म, कहानी का असली मोड़ अब आएगा!
Run chahiye, himmat chahiye, aur thoda sa jigra! Chalo! | Run चाहिए, हिम्मत चाहिए, और थोड़ा सा जिगरा! चलो!
''')
m('fanCam', 2, 'laughing out loud, delighted by the crazy fans', '''
Arre yeh dekho! Poori body pe rang, aur dil mein team! | अरे ये देखो! पूरी body पे रंग, और दिल में team!
Inko sardi nahi lagti, guru, inko sirf cricket lagta hai! | इनको सर्दी नहीं लगती, गुरु, इनको सिर्फ़ cricket लगता है!
Shirt utaari, jhanda uthaaya... asli fan yahi hai! | Shirt उतारी, झंडा उठाया... असली fan यही है!
Oye hoye! Pet pe score likha hai, dil pe naam! | ओए होए! पेट पे score लिखा है, दिल पे नाम!
Camera dekh ke aise naache jaise baraat mein dulhe ka bhai! | Camera देख के ऐसे नाचे जैसे बारात में दूल्हे का भाई!
''')
m('cheerCam', 1, 'cheeky and delighted', '''
Aur yeh dekhiye, cheerleaders ka special number! | और ये देखिए, cheerleaders का special number!
Chhakka pada, aur stage pe dhamaal! | छक्का पड़ा, और stage पे धमाल!
Is shot pe toh poora stadium naach utha! | इस shot पे तो पूरा stadium नाच उठा!
''')

# His own famous lines (the user asked for them, 2026-11-14), verbatim as published in Sportskeeda,
# ThePrint and Wikiquote collections of "Sidhuisms". Appended to the moments they suit and picked
# three times as readily (w: 3). Left out: the sexist ones and any that mock a named player.
REAL = {}


def real_lines(name, rows):
    REAL.setdefault(name, []).extend(tuple(x.strip() for x in r.split('|')) for r in rows.strip().splitlines())


real_lines('six', '''
Air hostess ko hello bolkar aai gend! | Air hostess को hello बोलकर आई गेंद!
Toofani chhakka, sultani chhakka, aur Hindustan hakka bakka! | तूफ़ानी छक्का, सुल्तानी छक्का, और हिंदुस्तान हक्का बक्का!
That ball went so high, it could have got an air hostess down with it! | That ball went so high, it could have got an air hostess down with it!
''')
real_lines('bowled', '''
The gap between bat and pad is so much, I would have driven a car through it! | The gap between bat and pad is so much, I would have driven a car through it!
''')
real_lines('threeWickets', '''
They are like bicycles in the cycle stand: if one falls down, the complete row will be down! | They are like bicycles in the cycle stand: if one falls down, the complete row will be down!
''')
real_lines('beaten', '''
Agar meri chachi ke moochh hoti, toh main unhe chacha kehta! | अगर मेरी चाची के मूँछ होती, तो मैं उन्हें चाचा कहता!
''')
real_lines('betweenOvers', '''
Positive anything is better than negative nothing. | Positive anything is better than negative nothing.
Patience is bitter, but the fruit is sweet. | Patience is bitter, but the fruit is sweet.
No one travels the road to success without a puncture or two. | No one travels the road to success without a puncture or two.
Experience is like a comb that life gives you when you are bald. | Experience is like a comb that life gives you when you are bald.
Duniya mein sabse bada rog, mere baare mein kya kahenge log! | दुनिया में सबसे बड़ा रोग, मेरे बारे में क्या कहेंगे लोग!
The only thing that can be earned without hard work is dandruff. | The only thing that can be earned without hard work is dandruff.
Humility is like an underwear: you have to wear it, but you should not show it. | Humility is like an underwear: you have to wear it, but you should not show it.
If one-day cricket was pyjama cricket, then Twenty20 is underwear cricket! | If one-day cricket was pyjama cricket, then Twenty20 is underwear cricket!
Hope sees the invisible, feels the tangible. Hope is the biggest tope! | Hope sees the invisible, feels the tangible. Hope is the biggest तोप!
''')
real_lines('batterStruggling', '''
Adversity will come, adversity will stare at you, but it's adversity that will make you better. | Adversity will come, adversity will stare at you, but it's adversity that will make you better.
''')
real_lines('batterSet', '''
It's choice, not chance, that determines your destiny. | It's choice, not chance, that determines your destiny.
''')
real_lines('lastOver', '''
Nobody reads the novel to reach the middle of the story, it's the ending which is more important. | Nobody reads the novel to reach the middle of the story, it's the ending which is more important.
''')
real_lines('won', '''
You rate the ability of a man with what they finish, not with what they attempt. | You rate the ability of a man with what they finish, not with what they attempt.
''')
real_lines('sledge', '''
Even a hen, while laying an egg, cackles as if it is an asteroid! | Even a hen, while laying an egg, cackles as if it is an asteroid!
''')
real_lines('bowlerExpensive', '''
His bowling at the moment is flat as a dosa. | His bowling at the moment is flat as a dosa.
''')

out = []
for name, (prio, note, rows) in M.items():
    for i, (lat, dev) in enumerate(rows, 1):
        out.append({'id': f'{name}_{i:02d}', 'moment': name, 'prio': prio, 'note': note, 'text': lat, 'say': dev})
    for i, (lat, dev) in enumerate(REAL.get(name, []), 1):
        out.append({'id': f'{name}_r{i:02d}', 'moment': name, 'prio': prio, 'note': note, 'text': lat, 'say': dev, 'w': 3})
assert set(REAL) <= set(M), set(REAL) - set(M)
json.dump(out, open(os.path.join(HERE, 'script.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
# the game bundles the subtitles (and moments, priorities) so it works if the audio fails to load
js = os.path.join(HERE, '..', '..', 'games', 'cricket', 'commentary-lines.js')
NL = chr(10)
rows = (',' + NL).join('    ' + json.dumps({k: x[k] for k in ('id', 'moment', 'prio', 'text', 'w') if k in x}, ensure_ascii=False) for x in out)
src = [
    "// Paaji's lines (generated by tools/commentary/build_script.py; edit there). Original, written for Willowlight.",
    '(function (root) {',
    '  const LINES = [',
    rows,
    '  ];',
    "  if (typeof module !== 'undefined' && module.exports) module.exports = { LINES };",
    '  if (root) { root.CK = root.CK || {}; root.CK.CommentaryLines = LINES; }',
    "})(typeof window !== 'undefined' ? window : null);",
    '']
open(js, 'w', encoding='utf-8').write(NL.join(src))
print(len(out), 'lines,', len(M), 'moments')
