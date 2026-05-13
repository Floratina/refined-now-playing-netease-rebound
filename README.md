# Refined Now Playing

一个美化网易云音乐播放界面的 [BetterNCM](https://github.com/MicroCBer/BetterNCM) 插件

增加了全新的伪流体效果，降低 50% 以上的 GPU 占用。

# 已知问题

该伪流体在 C++ & CEF 编写的旧版本网易云上会比较频繁地触发内存的 GC，每次 GC 的时候 JS 主线程会短暂卡死，导致流体卡住十几毫秒。受限于老版本网易云和 BetterNCM 的架构，该问题可能无法修复。

# 安装

0. 安装 [BetterNCM](https://github.com/MicroCBer/BetterNCM) 插件
1. 在插件商店中安装

# 效果

![preview.mp4](https://github.com/viceasha2008/refined-now-playing-netease-rebound/blob/master/preview.mp4)
