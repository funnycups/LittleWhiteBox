import { extension_settings, getContext } from "../../../extensions.js";
import { saveSettingsDebounced, eventSource, event_types } from "../../../../script.js";

const EXT_ID = "LittleWhiteBox";
const MODULE_NAME = "wallhavenBackground";

const defaultSettings = {
    enabled: false,
    bgMode: false,
    category: "010",
    purity: "100",
    opacity: 0.3,
};

const wallhavenTags = {
    characters: {
        "女孩": "anime girl", "少女": "anime girl", "女性": "woman", "女人": "woman",
        "男孩": "boy", "少年": "boy", "男性": "man", "男人": "man",
        "女仆": "maid", "侍女": "maid", "佣人": "maid",
        "公主": "princess", "殿下": "princess", "王女": "princess",
        "护士": "nurse", "白衣天使": "nurse", "医护": "nurse",
        "老师": "teacher", "教师": "teacher", "先生": "teacher",
        "学生": "student", "学员": "student", 
        "同学": "student", "男同学": "male student", "女同学": "schoolgirl",
        "女学生": "schoolgirl", "男学生": "male student",
        "猫娘": "catgirl", "猫女": "catgirl", "猫咪女孩": "catgirl",
        "狐娘": "fox girl", "狐狸女孩": "fox girl", "狐仙": "fox girl",
        "兔娘": "bunny girl", "兔女郎": "bunny girl", "兔子女孩": "bunny girl",
        "魔女": "witch", "女巫": "witch", "巫女": "witch",
        "天使": "angel", "小天使": "angel",
        "恶魔": "demon", "魅魔": "demon", "小恶魔": "demon",
        "精灵": "elf", "森林精灵": "elf",
        "吸血鬼": "vampire", "血族": "vampire",
        "忍者": "ninja", "女忍": "ninja",
        "修女": "nun", "尼姑": "nun",
        "新娘": "bride", "新嫁娘": "bride",
        "母亲": "mother", "妈妈": "mother",
        "姐姐": "sister", "妹妹": "sister",
        "女儿": "daughter", "闺女": "daughter",
        "王子": "prince", "殿下": "prince",
        "骑士": "knight", "武士": "warrior",
        "法师": "wizard", "魔法师": "wizard",
        "医生": "doctor", "大夫": "doctor",
        "警察": "police", "警官": "police",
        "消防员": "firefighter", "消防": "firefighter",
        "军人": "soldier", "士兵": "soldier",
        "厨师": "chef", "料理师": "chef",
        "艺术家": "artist", "画家": "artist",
        "音乐家": "musician", "歌手": "singer",
        "科学家": "scientist", "研究员": "scientist",
        "程序员": "programmer", "工程师": "engineer",
        "商人": "businessman", "老板": "boss",
        "管家": "butler", "司机": "driver",
        "侦探": "detective", "探长": "detective"
    },
    
    clothing: {
        "连衣裙": "dress", "裙子": "dress", "长裙": "long dress", "短裙": "short dress",
        "校服": "school uniform", "制服": "uniform", "学生服": "school uniform",
        "女仆装": "maid outfit", "女仆服": "maid outfit",
        "护士服": "nurse outfit", "白大褂": "nurse outfit",
        "和服": "kimono", "浴衣": "kimono", "振袖": "kimono",
        "旗袍": "qipao", "中式服装": "chinese dress",
        "婚纱": "wedding dress", "新娘装": "wedding dress",
        "泳装": "swimsuit", "泳衣": "swimsuit", "比基尼": "bikini",
        "睡衣": "pajamas", "居家服": "pajamas", "睡袍": "nightgown",
        "内衣": "lingerie", "胸罩": "bra", "内裤": "panties",
        "丝袜": "stockings", "长筒袜": "stockings", "连裤袜": "pantyhose",
        "高跟鞋": "high heels", "靴子": "boots", "凉鞋": "sandals",
        "手套": "gloves", "帽子": "hat", "眼镜": "glasses",
        "项链": "necklace", "耳环": "earrings", "戒指": "ring",
        "西装": "suit", "领带": "tie", "衬衫": "shirt",
        "夹克": "jacket", "外套": "coat", "毛衣": "sweater",
        "牛仔裤": "jeans", "裤子": "pants", "短裤": "shorts",
        "运动服": "sportswear", "运动鞋": "sneakers",
        "围裙": "apron", "头巾": "headband",
        "军装": "military uniform", "警服": "police uniform"
    },
    
    body_features: {
        "长发": "long hair", "短发": "short hair", "马尾": "ponytail", "双马尾": "twintails",
        "黑发": "black hair", "金发": "blonde hair", "棕发": "brown hair", 
        "白发": "white hair", "银发": "silver hair", "红发": "red hair",
        "蓝发": "blue hair", "粉发": "pink hair", "紫发": "purple hair",
        "大胸": "large breasts", "巨乳": "huge breasts", "丰满": "large breasts",
        "小胸": "small breasts", "贫乳": "small breasts", "平胸": "flat chest",
        "高个": "tall", "矮个": "short", "娇小": "petite",
        "苗条": "slim", "纤细": "slim", "丰满": "curvy",
        "猫耳": "cat ears", "狐耳": "fox ears", "兔耳": "bunny ears",
        "翅膀": "wings", "尾巴": "tail", "角": "horns",
        "肌肉": "muscular", "强壮": "muscular", "健美": "athletic",
        "胡子": "beard", "胡须": "mustache", "光头": "bald",
        "疤痕": "scar", "纹身": "tattoo",
        "美腿": "beautiful legs", "修长": "slender", "饱满": "full",
        "挺拔": "perky", "下垂": "sagging", "紧致": "firm",
        "柔软": "soft", "光滑": "smooth", "粗糙": "rough",
        "白皙": "fair", "古铜": "tanned", "健康": "healthy",
        "性感": "sexy", "诱人": "attractive", "迷人": "charming"
    },
    
    expressions: {
        "微笑": "smile", "笑": "smile", "开心": "happy", "高兴": "happy",
        "伤心": "sad", "难过": "sad", "哭": "crying", "流泪": "tears",
        "生气": "angry", "愤怒": "angry", "恼火": "angry",
        "害羞": "shy", "脸红": "blushing", "羞涩": "shy",
        "惊讶": "surprised", "吃惊": "surprised", "震惊": "shocked",
        "温柔": "gentle", "柔和": "gentle", "亲切": "gentle",
        "严肃": "serious", "认真": "serious", "冷静": "calm",
        "困": "sleepy", "累": "tired", "疲倦": "tired",
        "兴奋": "excited", "激动": "excited", "愉快": "cheerful",
        "冷漠": "indifferent", "无表情": "expressionless",
        "思考": "thinking", "专注": "focused", "集中": "concentrated",
        "紧张": "nervous", "担心": "worried", "焦虑": "anxious",
        "自信": "confident", "骄傲": "proud", "得意": "smug"
    },
    
    poses: {
        "站着": "standing", "站立": "standing",
        "坐着": "sitting", "坐下": "sitting",
        "躺着": "lying", "躺下": "lying",
        "跪着": "kneeling", "下跪": "kneeling",
        "走路": "walking", "行走": "walking",
        "跑步": "running", "奔跑": "running",
        "跳舞": "dancing", "舞蹈": "dancing",
        "睡觉": "sleeping", "熟睡": "sleeping",
        "拥抱": "hugging", "抱着": "hugging",
        "举手": "arms up", "抬手": "arms up",
        "看书": "reading", "阅读": "reading",
        "写字": "writing", "书写": "writing",
        "工作": "working", "学习": "studying",
        "做作业": "homework", "写作业": "homework",
        "战斗": "fighting", "格斗": "combat",
        "冥想": "meditation", "思考": "thinking",
        "游泳": "swimming", "潜水": "diving",
        "爬山": "climbing", "攀登": "climbing",
        "骑车": "cycling", "开车": "driving"
    },
    
    locations: {
        "卧室": "bedroom", "房间": "bedroom", "寝室": "bedroom",
        "教室": "classroom", "课堂": "classroom", "学校": "school",
        "图书馆": "library", "书馆": "library",
        "医院": "hospital", "诊所": "hospital",
        "咖啡厅": "cafe", "咖啡店": "cafe",
        "餐厅": "restaurant", "饭店": "restaurant",
        "公园": "park", "花园": "garden", "庭院": "garden",
        "海边": "beach", "沙滩": "beach", "海滩": "beach",
        "森林": "forest", "树林": "forest",
        "山": "mountain", "高山": "mountain",
        "湖边": "lake", "湖泊": "lake",
        "厨房": "kitchen", "灶间": "kitchen",
        "浴室": "bathroom", "洗手间": "bathroom",
        "办公室": "office", "工作室": "office",
        "城堡": "castle", "宫殿": "castle",
        "教堂": "church", "寺庙": "temple",
        "桥": "bridge", "大桥": "bridge",
        "屋顶": "rooftop", "天台": "rooftop",
        "实验室": "laboratory", "研究室": "laboratory",
        "工厂": "factory", "车间": "workshop",
        "商店": "shop", "超市": "supermarket",
        "酒吧": "bar", "夜店": "nightclub",
        "游乐园": "amusement park", "动物园": "zoo",
        "博物馆": "museum", "美术馆": "art gallery",
        "火车站": "train station", "机场": "airport"
    },
    
    weather_time: {
        "晴天": "sunny", "阳光": "sunny", "晴朗": "sunny",
        "下雨": "rain", "雨天": "rainy", "雨": "rain",
        "下雪": "snow", "雪天": "snowy", "雪": "snow",
        "多云": "cloudy", "阴天": "cloudy",
        "日出": "sunrise", "清晨": "morning", "早晨": "morning",
        "日落": "sunset", "黄昏": "sunset", "夕阳": "sunset",
        "夜晚": "night", "晚上": "night", "深夜": "night",
        "白天": "day", "日间": "day",
        "春天": "spring", "夏天": "summer", "秋天": "autumn", "冬天": "winter",
        "月光": "moonlight", "星空": "starry sky", "彩虹": "rainbow",
        "雷雨": "thunderstorm", "闪电": "lightning", "雾": "fog"
    },
    
    colors: {
        "红色": "red", "红": "red", "朱红": "red",
        "粉色": "pink", "粉红": "pink", "粉": "pink",
        "橙色": "orange", "橘色": "orange", "橙": "orange",
        "黄色": "yellow", "黄": "yellow", "金黄": "yellow",
        "绿色": "green", "绿": "green", "翠绿": "green",
        "蓝色": "blue", "蓝": "blue", "天蓝": "blue",
        "紫色": "purple", "紫": "purple", "紫罗兰": "purple",
        "黑色": "black", "黑": "black", "乌黑": "black",
        "白色": "white", "白": "white", "洁白": "white",
        "灰色": "gray", "灰": "gray", "银灰": "gray",
        "棕色": "brown", "褐色": "brown", "咖啡色": "brown",
        "银色": "silver", "金色": "gold"
    },
    
    objects: {
        "书": "book", "书本": "book", "图书": "book",
        "花": "flower", "鲜花": "flower", "花朵": "flower",
        "玫瑰": "rose", "樱花": "cherry blossom",
        "杯子": "cup", "茶杯": "teacup", "咖啡杯": "coffee cup",
        "镜子": "mirror", "时钟": "clock", "钟": "clock",
        "剑": "sword", "刀": "sword", "魔法棒": "magic wand",
        "吉他": "guitar", "钢琴": "piano", "小提琴": "violin",
        "相机": "camera", "照相机": "camera",
        "伞": "umbrella", "雨伞": "umbrella",
        "包": "bag", "书包": "bag", "手提包": "handbag",
        "枕头": "pillow", "抱枕": "pillow", "毯子": "blanket",
        "电脑": "computer", "笔记本": "laptop", "手机": "phone",
        "汽车": "car", "自行车": "bicycle", "摩托车": "motorcycle",
        "飞机": "airplane", "船": "ship", "火车": "train"
    },
    
    styles: {
        "可爱": "cute", "美丽": "beautiful", "漂亮": "pretty",
        "优雅": "elegant", "高贵": "noble", "华丽": "gorgeous",
        "性感": "sexy", "迷人": "charming", "诱惑": "seductive",
        "清纯": "innocent", "纯洁": "pure", "天真": "innocent",
        "成熟": "mature", "稳重": "mature", "知性": "intellectual",
        "活泼": "lively", "开朗": "cheerful", "阳光": "bright",
        "神秘": "mysterious", "冷酷": "cool", "高冷": "cold",
        "温暖": "warm", "舒适": "comfortable", "宁静": "peaceful",
        "浪漫": "romantic", "梦幻": "dreamy", "奇幻": "fantasy",
        "古典": "classic", "复古": "vintage", "现代": "modern",
        "帅气": "handsome", "英俊": "handsome", "潇洒": "dashing",
        "强大": "powerful", "威猛": "mighty", "勇敢": "brave",
        "绅士": "gentleman", "风度": "graceful", "魅力": "charismatic"
    },

    activities: {
        "学习": "studying", "上课": "attending class", "考试": "exam",
        "做饭": "cooking", "吃饭": "eating", "喝茶": "drinking tea",
        "购物": "shopping", "逛街": "shopping", "买东西": "shopping",
        "约会": "dating", "恋爱": "romance", "表白": "confession",
        "旅行": "travel", "度假": "vacation", "观光": "sightseeing",
        "运动": "sports", "健身": "fitness", "锻炼": "exercise",
        "游戏": "gaming", "玩耍": "playing", "娱乐": "entertainment",
        "工作": "working", "加班": "overtime", "会议": "meeting",
        "聚会": "party", "庆祝": "celebration", "生日": "birthday",
        "结婚": "wedding", "婚礼": "wedding ceremony",
        "调戏": "teasing", "戏弄": "teasing", "挑逗": "flirting",
        "撩": "flirting", "撩拨": "flirting", "勾引": "seduction",
        "诱惑": "seduction", "魅惑": "seduction", "撒娇": "acting cute",
        "卖萌": "acting cute", "害羞": "shy", "脸红": "blushing",
        "接吻": "kissing", "亲吻": "kissing", "亲": "kissing",
        "拥抱": "hugging", "抱": "hugging", "搂": "embracing",
        "牵手": "holding hands", "握手": "handshake",
        "抚摸": "caressing", "爱抚": "caressing", "按摩": "massage",
        "洗澡": "bathing", "沐浴": "bathing", "泡澡": "bathing",
        "睡觉": "sleeping", "午睡": "napping", "休息": "resting",
        "梦": "dreaming", "做梦": "dreaming", "梦见": "dreaming",
        "偷看": "peeking", "窥视": "voyeur", "偷窥": "voyeur",
        "展示": "showing", "炫耀": "showing off", "露出": "exposing"
    },

    body_parts: {
        "胸": "breasts", "胸部": "breasts", "乳房": "breasts",
        "胸罩": "bra", "内衣": "underwear", "内裤": "panties",
        "腿": "legs", "大腿": "thighs", "小腿": "calves",
        "脚": "feet", "足": "feet", "脚趾": "toes",
        "手": "hands", "手指": "fingers", "指甲": "nails",
        "嘴": "mouth", "嘴唇": "lips", "舌头": "tongue",
        "眼睛": "eyes", "眼": "eyes", "眼神": "gaze",
        "脸": "face", "脸颊": "cheeks", "下巴": "chin",
        "脖子": "neck", "肩膀": "shoulders", "背": "back",
        "腰": "waist", "臀部": "hips", "屁股": "butt",
        "肚子": "belly", "腹部": "abdomen", "肚脐": "navel",
        "皮肤": "skin", "身体": "body", "身材": "figure",
        "头发": "hair", "发型": "hairstyle", "刘海": "bangs"
    },

    nsfw_actions: {
        "做爱": "sex", "性爱": "sex", "交配": "mating",
        "插入": "penetration", "进入": "penetration", "插": "insertion",
        "抽插": "thrusting", "律动": "thrusting", "顶": "thrusting",
        "高潮": "orgasm", "射精": "ejaculation", "喷": "squirting",
        "口交": "oral sex", "舔": "licking", "吸": "sucking",
        "肛交": "anal sex", "后入": "doggy style", "骑乘": "cowgirl",
        "传教士": "missionary", "侧位": "side position",
        "手淫": "masturbation", "自慰": "masturbation", "撸": "stroking",
        "指交": "fingering", "抚弄": "fondling", "揉": "massaging",
        "爱液": "love juice", "精液": "semen", "体液": "bodily fluids",
        "湿润": "wet", "润滑": "lubricated", "紧": "tight",
        "松": "loose", "深": "deep", "浅": "shallow",
        "快": "fast", "慢": "slow", "用力": "hard",
        "轻": "gentle", "粗暴": "rough", "激烈": "intense"
    },

    nsfw_body_parts: {
        "阴茎": "penis", "鸡巴": "cock", "肉棒": "dick",
        "龟头": "glans", "包皮": "foreskin", "睾丸": "testicles",
        "阴道": "vagina", "小穴": "pussy", "阴唇": "labia",
        "阴蒂": "clitoris", "子宫": "womb", "G点": "g-spot",
        "肛门": "anus", "菊花": "asshole", "后庭": "backdoor",
        "乳头": "nipples", "乳晕": "areola", "奶子": "tits",
        "屁眼": "butthole", "会阴": "perineum", "前列腺": "prostate",
        "敏感点": "sensitive spot", "私处": "private parts",
        "下体": "genitals", "性器": "sex organ", "欲火": "lust"
    },

    nsfw_states: {
        "勃起": "erect", "硬": "hard", "坚挺": "stiff",
        "湿": "wet", "潮湿": "moist", "流水": "dripping",
        "紧": "tight", "夹紧": "clenching", "收缩": "contracting",
        "胀": "swollen", "肿": "enlarged", "充血": "engorged",
        "敏感": "sensitive", "酥麻": "tingling", "颤抖": "trembling",
        "兴奋": "aroused", "冲动": "horny", "发情": "in heat",
        "欲火": "lustful", "渴望": "craving", "饥渴": "thirsty",
        "满足": "satisfied", "空虚": "empty", "饱满": "full",
        "疼": "painful", "爽": "pleasurable", "舒服": "comfortable"
    },

    nsfw_sounds: {
        "呻吟": "moaning", "叫床": "moaning", "娇喘": "panting",
        "喘息": "breathing heavily", "哼": "humming", "嗯": "mmm",
        "啊": "ah", "哦": "oh", "嘤": "whimpering",
        "尖叫": "screaming", "呼喊": "crying out", "低吟": "groaning",
        "啜泣": "sobbing", "哽咽": "choking", "喘气": "gasping",
        "叫声": "vocal", "声音": "sounds", "噪音": "noise"
    },

    nsfw_descriptions: {
        "色情": "pornographic", "淫荡": "lewd", "下流": "vulgar",
        "淫乱": "promiscuous", "放荡": "wanton", "骚": "slutty",
        "浪": "naughty", "骚货": "slut", "淫娃": "sex kitten",
        "处女": "virgin", "纯洁": "pure", "清纯": "innocent",
        "经验": "experienced", "熟女": "mature woman", "老练": "skilled",
        "禁忌": "taboo", "变态": "pervert", "调教": "training",
        "支配": "domination", "服从": "submission", "奴隶": "slave",
        "主人": "master", "女王": "queen", "调教": "discipline"
    },

    intimate_settings: {
        "床": "bed", "床上": "on bed", "床单": "bedsheet",
        "被子": "blanket", "枕头": "pillow", "卧室": "bedroom",
        "浴室": "bathroom", "浴缸": "bathtub", "淋浴": "shower",
        "沙发": "sofa", "地板": "floor", "墙": "wall",
        "桌子": "table", "椅子": "chair", "车里": "in car",
        "野外": "outdoors", "森林": "forest", "海滩": "beach",
        "办公室": "office", "教室": "classroom", "厕所": "toilet",
        "更衣室": "changing room", "试衣间": "fitting room",
        "酒店": "hotel", "旅馆": "motel", "温泉": "hot spring"
    },

    fetish_categories: {
        "丝袜": "stockings", "高跟鞋": "high heels", "制服": "uniform",
        "蕾丝": "lace", "皮革": "leather", "乳胶": "latex",
        "束缚": "bondage", "绳子": "rope", "手铐": "handcuffs",
        "眼罩": "blindfold", "口球": "gag", "项圈": "collar",
        "鞭子": "whip", "蜡烛": "candle", "冰块": "ice",
        "玩具": "toy", "按摩棒": "vibrator", "假阳具": "dildo",
        "跳蛋": "bullet vibrator", "肛塞": "butt plug",
        "触手": "tentacle", "怪物": "monster", "野兽": "beast",
        "机器": "machine", "机械": "mechanical", "人工": "artificial"
    },

    body_modifications: {
        "纹身": "tattoo", "穿孔": "piercing", "疤痕": "scar",
        "胎记": "birthmark", "雀斑": "freckles", "痣": "mole",
        "肌肉": "muscle", "腹肌": "abs", "人鱼线": "v-line",
        "马甲线": "ab line", "锁骨": "collarbone", "腰窝": "dimples",
        "美人痣": "beauty mark", "酒窝": "dimple", "虎牙": "fangs"
    },

    clothing_states: {
        "裸体": "nude", "全裸": "completely nude", "半裸": "topless",
        "透明": "transparent", "半透明": "see-through", "薄": "thin",
        "紧身": "tight", "宽松": "loose", "短": "short",
        "露": "exposed", "露出": "showing", "展示": "displaying",
        "脱": "undressing", "穿": "dressing", "换": "changing",
        "撕": "tearing", "破": "torn", "湿": "wet",
        "脏": "dirty", "污": "stained", "乱": "messy"
    },

    romance_keywords: {
        "恋人": "lovers", "情侣": "couple", "男友": "boyfriend",
        "女友": "girlfriend", "爱人": "lover", "心上人": "sweetheart",
        "初恋": "first love", "暗恋": "crush", "单恋": "unrequited love",
        "心动": "heartbeat", "怦然心动": "heart racing", "脸红心跳": "blushing",
        "甜蜜": "sweet", "浪漫": "romantic", "温馨": "warm",
        "幸福": "happy", "快乐": "joyful", "满足": "satisfied",
        "想念": "missing", "思念": "longing", "牵挂": "caring",
        "嫉妒": "jealous", "吃醋": "jealous", "争风吃醋": "jealous",
        "分手": "breakup", "复合": "reunion", "和好": "reconcile",
        "求婚": "proposal", "订婚": "engagement", "蜜月": "honeymoon"
    },

    emotional_states: {
        "欲望": "desire", "渴望": "longing", "冲动": "impulse",
        "兴奋": "excited", "激动": "aroused", "刺激": "stimulation",
        "满足": "satisfied", "愉悦": "pleasure", "舒服": "comfortable",
        "紧张": "nervous", "不安": "anxious", "忐忑": "restless",
        "期待": "anticipation", "好奇": "curious", "探索": "exploration",
        "羞耻": "shame", "羞愧": "ashamed", "不好意思": "embarrassed",
        "大胆": "bold", "勇敢": "brave", "主动": "proactive",
        "被动": "passive", "顺从": "submissive", "听话": "obedient",
        "反抗": "resistant", "挣扎": "struggling", "拒绝": "refusing"
    }
};

let isProcessing = false;
let currentProgressButton = null;

function getWallhavenSettings() {
    if (!extension_settings[EXT_ID].wallhavenBackground) {
        extension_settings[EXT_ID].wallhavenBackground = structuredClone(defaultSettings);
    }
    const settings = extension_settings[EXT_ID].wallhavenBackground;
    for (const key in defaultSettings) {
        if (settings[key] === undefined) {
            settings[key] = defaultSettings[key];
        }
    }
    return settings;
}

function showProgressInMessageHeader(messageElement, text) {
    const flexContainer = messageElement.querySelector('.flex-container.flex1.alignitemscenter');
    if (!flexContainer) return null;
    
    removeProgressFromMessageHeader();
    
    const progressButton = document.createElement('div');
    progressButton.className = 'mes_btn wallhaven_progress_indicator';
    progressButton.style.cssText = `
        color: #007acc !important;
        cursor: default !important;
        font-size: 11px !important;
        padding: 2px 6px !important;
        opacity: 0.9;
    `;
    progressButton.innerHTML = `<i class="fa-solid fa-spinner fa-spin" style="margin-right: 4px;"></i>${text}`;
    progressButton.title = '正在为消息生成配图...';
    
    flexContainer.appendChild(progressButton);
    currentProgressButton = progressButton;
    
    return progressButton;
}

function updateProgressText(text) {
    if (currentProgressButton) {
        currentProgressButton.innerHTML = `<i class="fa-solid fa-spinner fa-spin" style="margin-right: 4px;"></i>${text}`;
    }
}

function removeProgressFromMessageHeader() {
    if (currentProgressButton) {
        currentProgressButton.remove();
        currentProgressButton = null;
    }
    document.querySelectorAll('.wallhaven_progress_indicator').forEach(el => el.remove());
}

function extractTagsFromText(text) {
    const extractedEnglishTags = new Set();
    Object.keys(wallhavenTags).forEach(category => {
        Object.entries(wallhavenTags[category]).forEach(([chinese, english]) => {
            if (text.includes(chinese)) {
                extractedEnglishTags.add(english);
            }
        });
    });
    return { tags: Array.from(extractedEnglishTags) };
}

async function searchSingleTag(tag, category, purity, isBgMode) {
    let searchTag = tag;
    if (isBgMode) {
        searchTag = `${tag} -girl -male -people -anime`;
    }
    const ratios = "9x16,10x16,1x1,9x18";
    const wallhavenUrl = `https://wallhaven.cc/api/v1/search?q=${encodeURIComponent(searchTag)}&categories=${category}&purity=${purity}&ratios=${ratios}&sorting=favorites&page=1&`;
    const proxyUrl = 'https://api.allorigins.win/raw?url=';
    const finalUrl = proxyUrl + encodeURIComponent(wallhavenUrl);
    try {
        const response = await fetch(finalUrl);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json();
        return {
            tag: tag,
            success: true,
            total: data.meta.total,
            images: data.data || []
        };
    } catch (error) {
        return {
            tag: tag,
            success: false,
            error: error.message,
            total: 0,
            images: []
        };
    }
}

async function intelligentTagMatching(tags, settings) {
    if (!tags || tags.length === 0) {
        throw new Error('没有可用的标签');
    }
    const targetTags = [...new Set(tags.filter(tag => tag.trim()))];
    const allImages = new Map();
    
    for (let i = 0; i < Math.min(targetTags.length, 5); i++) {
        const tag = targetTags[i];
        updateProgressText(`搜索 ${i + 1}/${Math.min(targetTags.length, 5)}: ${tag}`);
        const result = await searchSingleTag(tag, settings.category, settings.purity, settings.bgMode);
        if (result.success) {
            result.images.forEach(img => {
                if (!allImages.has(img.id)) {
                    allImages.set(img.id, {
                        ...img,
                        matchedTags: [tag],
                        matchCount: 1
                    });
                } else {
                    const existingImg = allImages.get(img.id);
                    existingImg.matchedTags.push(tag);
                    existingImg.matchCount++;
                }
            });
        }
        if (i < targetTags.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }
    
    const allImagesArray = Array.from(allImages.values());
    if (allImagesArray.length === 0) {
        throw new Error('所有标签都没有找到匹配的图片');
    }
    
    allImagesArray.sort((a, b) => {
        if (b.matchCount !== a.matchCount) {
            return b.matchCount - a.matchCount;
        }
        return b.favorites - a.favorites;
    });
    
    const maxMatchCount = allImagesArray[0].matchCount;
    const bestMatches = allImagesArray.filter(img => img.matchCount === maxMatchCount);
    const randomIndex = Math.floor(Math.random() * bestMatches.length);
    
    return bestMatches[randomIndex];
}

function applyBackgroundToChat(imageUrl, settings) {
    const chatElement = document.getElementById('chat');
    if (!chatElement) return;

    let backgroundContainer = document.getElementById('wallhaven-chat-background');
    let overlay = document.getElementById('wallhaven-chat-overlay');

    if (!backgroundContainer) {
        backgroundContainer = document.createElement('div');
        backgroundContainer.id = 'wallhaven-chat-background';
        backgroundContainer.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background-size: 100% 100%;
            background-position: center;
            background-repeat: no-repeat;
            z-index: -2;
            pointer-events: none;
        `;
        chatElement.insertBefore(backgroundContainer, chatElement.firstChild);
    }

    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'wallhaven-chat-overlay';
        overlay.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background-color: rgba(0, 0, 0, ${settings.opacity});
            z-index: -1;
            pointer-events: none;
        `;
        chatElement.insertBefore(overlay, chatElement.firstChild);
    }

    backgroundContainer.style.backgroundImage = `url("${imageUrl}")`;
    overlay.style.backgroundColor = `rgba(0, 0, 0, ${settings.opacity})`;
    
    chatElement.style.position = 'relative';
}

async function handleAIMessageForBackground(data) {
    const settings = getWallhavenSettings();
    if (!settings.enabled || isProcessing) return;
    
    const globalEnabled = window.isXiaobaixEnabled;
    if (!globalEnabled) return;
    
    try {
        isProcessing = true;
        
        setTimeout(async () => {
            try {
                const messageId = data.messageId || data;
                if (!messageId) return;
                
                const messageElement = document.querySelector(`div.mes[mesid="${messageId}"]`);
                if (!messageElement || messageElement.classList.contains('is_user')) return;
                
                const mesText = messageElement.querySelector('.mes_text');
                if (!mesText) return;
                
                const messageText = mesText.textContent || '';
                if (!messageText.trim()) return;
                
                showProgressInMessageHeader(messageElement, '提取标签中...');
                
                const result = extractTagsFromText(messageText);
                if (result.tags.length === 0) {
                    updateProgressText('未提取到标签');
                    setTimeout(removeProgressFromMessageHeader, 2000);
                    return;
                }
                
                updateProgressText(`提取到 ${result.tags.length} 个标签`);
                await new Promise(resolve => setTimeout(resolve, 500));
                
                const selectedImage = await intelligentTagMatching(result.tags, settings);
                
                updateProgressText('应用背景中...');
                const proxyImageUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(selectedImage.thumbs.large)}`;
                
                applyBackgroundToChat(proxyImageUrl, settings);
                
                updateProgressText('配图完成!');
                setTimeout(removeProgressFromMessageHeader, 1500);
                
            } catch (error) {
                updateProgressText(`配图失败: ${error.message.length > 20 ? error.message.substring(0, 20) + '...' : error.message}`);
                setTimeout(removeProgressFromMessageHeader, 3000);
            } finally {
                isProcessing = false;
            }
        }, 1000);
        
    } catch (error) {
        isProcessing = false;
        removeProgressFromMessageHeader();
    }
}

function updateSettingsControls() {
    const settings = getWallhavenSettings();
    $('#wallhaven_enabled').prop('checked', settings.enabled);
    $('#wallhaven_bg_mode').prop('checked', settings.bgMode);
    $('#wallhaven_category').val(settings.category);
    $('#wallhaven_purity').val(settings.purity);
    $('#wallhaven_opacity').val(settings.opacity);
    $('#wallhaven_opacity_value').text(Math.round(settings.opacity * 100) + '%');
}

function initSettingsEvents() {
    const settings = getWallhavenSettings();
    
    $('#wallhaven_enabled').on('change', function() {
        const globalEnabled = window.isXiaobaixEnabled;
        if (!globalEnabled) return;
        settings.enabled = $(this).prop('checked');
        saveSettingsDebounced();
        if (!settings.enabled) {
            $('#wallhaven-chat-background').remove();
            $('#wallhaven-chat-overlay').remove();
            removeProgressFromMessageHeader();
        }
    });
    
    $('#wallhaven_bg_mode').on('change', function() {
        if (!window.isXiaobaixEnabled) return;
        settings.bgMode = $(this).prop('checked');
        saveSettingsDebounced();
    });
    
    $('#wallhaven_category').on('change', function() {
        if (!window.isXiaobaixEnabled) return;
        settings.category = $(this).val();
        saveSettingsDebounced();
    });
    
    $('#wallhaven_purity').on('change', function() {
        if (!window.isXiaobaixEnabled) return;
        settings.purity = $(this).val();
        saveSettingsDebounced();
    });
    
    $('#wallhaven_opacity').on('input', function() {
        if (!window.isXiaobaixEnabled) return;
        settings.opacity = parseFloat($(this).val());
        $('#wallhaven_opacity_value').text(Math.round(settings.opacity * 100) + '%');
        $('#wallhaven-chat-overlay').css('background-color', `rgba(0, 0, 0, ${settings.opacity})`);
        saveSettingsDebounced();
    });
}

function handleGlobalStateChange(event) {
    const globalEnabled = event.detail.enabled;
    
    if (globalEnabled) {
        updateSettingsControls();
        initSettingsEvents();
    } else {
        $('#wallhaven-chat-background').remove();
        $('#wallhaven-chat-overlay').remove();
        removeProgressFromMessageHeader();
    }
}

function initWallhavenBackground() {
    const globalEnabled = window.isXiaobaixEnabled !== undefined ? window.isXiaobaixEnabled : true;
    
    if (globalEnabled) {
        updateSettingsControls();
        initSettingsEvents();
        eventSource.on(event_types.MESSAGE_RECEIVED, handleAIMessageForBackground);
        eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, handleAIMessageForBackground);
    }
    document.addEventListener('xiaobaixEnabledChanged', handleGlobalStateChange);
}

export { initWallhavenBackground };
