export const TYPE_OPTIONS = [
  // 海报设计
  { label: '宣传海报', category: '海报设计' },
  { label: '活动海报', category: '海报设计' },
  { label: '电影海报', category: '海报设计' },
  { label: '音乐海报', category: '海报设计' },
  { label: '论文海报', category: '海报设计' },
  { label: '商业广告', category: '海报设计' },
  // UI/UX设计
  { label: '手机App界面', category: 'UI/UX设计' },
  { label: '网页设计', category: 'UI/UX设计' },
  { label: '桌面软件界面', category: 'UI/UX设计' },
  { label: '图标设计', category: 'UI/UX设计' },
  { label: '仪表盘界面', category: 'UI/UX设计' },
  // 摄影
  { label: '人像摄影', category: '摄影' },
  { label: '风景摄影', category: '摄影' },
  { label: '街头摄影', category: '摄影' },
  { label: '产品摄影', category: '摄影' },
  { label: '微距摄影', category: '摄影' },
  { label: '航拍摄影', category: '摄影' },
  // 插画
  { label: '儿童绘本', category: '插画' },
  { label: '编辑插画', category: '插画' },
  { label: '概念设计', category: '插画' },
  { label: '科技插画', category: '插画' },
  { label: '美食插画', category: '插画' },
  // 品牌设计
  { label: 'Logo设计', category: '品牌设计' },
  { label: '名片设计', category: '品牌设计' },
  { label: '包装设计', category: '品牌设计' },
  { label: '字体设计', category: '品牌设计' },
  { label: 'VI视觉系统', category: '品牌设计' },
  // 建筑与空间
  { label: '建筑外观', category: '建筑与空间' },
  { label: '室内设计', category: '建筑与空间' },
  { label: '景观设计', category: '建筑与空间' },
  { label: '城市规划', category: '建筑与空间' },
  { label: '展厅设计', category: '建筑与空间' },
]

export const STYLE_OPTIONS = [
  // 传统艺术类
  { label: '水墨风', category: '传统艺术' },
  { label: '工笔画', category: '传统艺术' },
  { label: '浮世绘', category: '传统艺术' },
  { label: '敦煌壁画', category: '传统艺术' },
  { label: '木刻版画', category: '传统艺术' },
  { label: '青花瓷风', category: '传统艺术' },
  // 现代艺术类
  { label: '油画厚涂', category: '现代艺术' },
  { label: '水彩淡彩', category: '现代艺术' },
  { label: '极简线稿', category: '现代艺术' },
  { label: '波普艺术', category: '现代艺术' },
  { label: '拼贴风', category: '现代艺术' },
  { label: '涂鸦风', category: '现代艺术' },
  // 流行文化类
  { label: '二次元', category: '流行文化' },
  { label: '赛博朋克', category: '流行文化' },
  { label: '蒸汽波', category: '流行文化' },
  { label: '像素风', category: '流行文化' },
  { label: 'low poly', category: '流行文化' },
  { label: '吉卜力风', category: '流行文化' },
  { label: '美漫风', category: '流行文化' },
  // 材质拟态类
  { label: '黏土定格动画', category: '材质拟态' },
  { label: '纸雕风', category: '材质拟态' },
  { label: '刺绣风', category: '材质拟态' },
  { label: '糖霜饼干风', category: '材质拟态' },
  { label: '折纸风', category: '材质拟态' },
  { label: '玻璃彩绘', category: '材质拟态' },
]

export const MOOD_OPTIONS = [
  // 光线与时辰
  { label: '清晨柔光', category: '光线与时辰', gradient: 'linear-gradient(135deg, #FFE4B5, #FFF8DC)' },
  { label: '正午烈日', category: '光线与时辰', gradient: 'linear-gradient(135deg, #FFD700, #FFA500)' },
  { label: '黄金时刻', category: '光线与时辰', gradient: 'linear-gradient(135deg, #DAA520, #CD853F)' },
  { label: '蓝调暮光', category: '光线与时辰', gradient: 'linear-gradient(135deg, #4169E1, #6A5ACD)' },
  { label: '月光清冷', category: '光线与时辰', gradient: 'linear-gradient(135deg, #B0C4DE, #778899)' },
  { label: '星空夜', category: '光线与时辰', gradient: 'linear-gradient(135deg, #191970, #2F2F4F)' },
  // 天气与气候
  { label: '细雨迷蒙', category: '天气与气候', gradient: 'linear-gradient(135deg, #A9B7CC, #C8D6E5)' },
  { label: '倾盆暴雨', category: '天气与气候', gradient: 'linear-gradient(135deg, #4A5568, #2D3748)' },
  { label: '雪中寂静', category: '天气与气候', gradient: 'linear-gradient(135deg, #E8EDF2, #F0F4F8)' },
  { label: '雾气缭绕', category: '天气与气候', gradient: 'linear-gradient(135deg, #D5DBDB, #BDC3C7)' },
  { label: '风沙漫天', category: '天气与气候', gradient: 'linear-gradient(135deg, #C4A35A, #8B7355)' },
  { label: '雨后初霁', category: '天气与气候', gradient: 'linear-gradient(135deg, #87CEEB, #98D8C8)' },
  // 情绪色调
  { label: '温暖治愈', category: '情绪色调', gradient: 'linear-gradient(135deg, #FFB347, #FFCC33)' },
  { label: '冷寂孤独', category: '情绪色调', gradient: 'linear-gradient(135deg, #6B7B8D, #4A5568)' },
  { label: '梦幻柔焦', category: '情绪色调', gradient: 'linear-gradient(135deg, #DDA0DD, #E6E6FA)' },
  { label: '复古胶片', category: '情绪色调', gradient: 'linear-gradient(135deg, #C4956A, #8B7355)' },
  { label: '黑白高对比', category: '情绪色调', gradient: 'linear-gradient(135deg, #1A1A1A, #E0E0E0)' },
  { label: '霓虹迷幻', category: '情绪色调', gradient: 'linear-gradient(135deg, #FF00FF, #00FFFF)' },
  // 特别场景感
  { label: '影棚聚光灯', category: '特别场景', gradient: 'linear-gradient(135deg, #2C2C2C, #4A4A4A)' },
  { label: '烛光摇曳', category: '特别场景', gradient: 'linear-gradient(135deg, #CD853F, #DEB887)' },
  { label: '森林丁达尔光', category: '特别场景', gradient: 'linear-gradient(135deg, #228B22, #90EE90)' },
  { label: '水下光线', category: '特别场景', gradient: 'linear-gradient(135deg, #006994, #40E0D0)' },
  { label: '赛博霓虹', category: '特别场景', gradient: 'linear-gradient(135deg, #FF1493, #00BFFF)' },
  { label: '核爆强光', category: '特别场景', gradient: 'linear-gradient(135deg, #FF4500, #FFD700)' },
]
