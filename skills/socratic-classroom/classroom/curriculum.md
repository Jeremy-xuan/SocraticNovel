# 课程表 · 操作系统（cs-os）

> **课程定位**：计算机系硬课，**408 考纲四门之一 + 美式 CS 核心课**。
> **教材**：`Operating Systems: Three Easy Pieces`（OSTEP，Remzi & Andrea Arpaci-Dusseau，Wisconsin-Madison，v1.10）。
> 🔴 **OSTEP 原文只链不搬**（官网明文：*"INSTRUCTORS: please just link to them directly (instead of making a copy locally)"*）→ 下表挂**官方章节链接**；`materials/ch{NN}.md` 里放的是**我们自己写的教学材料**。
> **讲数**：**14 讲**（把 OSTEP 的 44 章正文 + 11 篇 Dialogue 裁剪合并而成，**不是逐章念**）。
> **每讲 30–45 分钟**，围绕一个核心疑问组织；提问、讲解、演示和拓展按学生当下的理解选择，以能解释和应用机制为目标。

---

## 全课结构（四大块）

| 块 | 讲次 | 一句话 |
|---|---|---|
| **Ⅰ 虚拟化 · CPU** | 1–4 | 一台 CPU 怎么让很多程序"同时"跑 |
| **Ⅱ 虚拟化 · 内存** | 5–8 | 每个程序都以为自己独占内存，凭什么 |
| **Ⅲ 并发** | 9–12 | 两个线程同时改一个数，为什么最后不是零 |
| **Ⅳ 持久化** | 13–14 | 断电那一刻，数据为什么还在 |

---

## 第 1 讲 · 一个程序怎么跑起来

- **核心疑问**：*一个核心怎样让两个程序都有执行机会，又能在切换时保留状态和控制权？*
- **OSTEP 章节**：[ch2 Introduction](https://pages.cs.wisc.edu/~remzi/OSTEP/intro.pdf)｜[ch4 Processes](https://pages.cs.wisc.edu/~remzi/OSTEP/cpu-intro.pdf)｜[ch6 Direct Execution](https://pages.cs.wisc.edu/~remzi/OSTEP/cpu-mechanisms.pdf)
- **本讲要回答**：进程是什么（为什么需要"进程"这个概念）／操作系统怎样让多个程序共享 CPU／**受限直接执行**：程序直接在 CPU 上运行时，操作系统怎样用**用户态/内核态**与**时钟中断**保持控制。
- **理解证据**：能解释“轮流执行”如何让多个程序获得机会、切换时为什么要保存状态，以及定时器中断和特权限制各解决什么问题；不要求学生先说出指定总结句。

## 第 2 讲 · 进程的 API 与生命周期

- **核心疑问**：*fork 之后，为什么会有两个"我"？*
- **OSTEP 章节**：[ch5 Process API](https://pages.cs.wisc.edu/~remzi/OSTEP/cpu-api.pdf)
- **本讲要回答**：`fork` / `exec` / `wait` 各自做什么／为什么 `fork` 之后父子都返回／**`fork` 之后 `exec` 之前**那个窗口里发生了什么。
- **理解证据**：能区分 `fork` 创建新进程与 `exec` 替换当前进程的程序映像，并说明两者可以怎样衔接。

## 第 3 讲 · 调度：谁来决定下一个跑谁

- **核心疑问**：*短任务为什么会被长任务堵住？*
- **OSTEP 章节**：[ch7 CPU Scheduling](https://pages.cs.wisc.edu/~remzi/OSTEP/cpu-sched.pdf)｜[ch8 Multi-level Feedback](https://pages.cs.wisc.edu/~remzi/OSTEP/cpu-sched-mlfq.pdf)
- **本讲要回答**：FIFO／SJF／STCF／RR 各自在优化什么／**为什么"最短任务优先"在线下做不到**（不知道未来的运行时间）／MLFQ 怎么用"历史行为"猜未来。
- **理解证据**：能说明 MLFQ 怎样利用已观察到的行为调整优先级，而不是预先知道任务未来的运行时间。

## 第 4 讲 · 更公平的调度与多核

- **核心疑问**：*随机也能做调度？*
- **OSTEP 章节**：[ch9 Lottery Scheduling](https://pages.cs.wisc.edu/~remzi/OSTEP/cpu-sched-lottery.pdf)｜[ch10 Multi-CPU Scheduling](https://pages.cs.wisc.edu/~remzi/OSTEP/cpu-sched-multi.pdf)
- **本讲要回答**：彩票调度怎么用随机性实现按比例分配／多核为什么带来**缓存一致性**问题／"每个 CPU 一个队列"与"共享一个队列"的取舍。
- **理解证据**：能解释彩票调度如何用随机抽取实现长期按权重分配，并区分长期比例与单次结果。

## 第 5 讲 · 内存：每个程序都有自己的世界

- **核心疑问**：*我的地址 0x1000 和他的 0x1000，为什么不是同一个地方？*
- **OSTEP 章节**：[ch13 Address Spaces](https://pages.cs.wisc.edu/~remzi/OSTEP/vm-intro.pdf)｜[ch14 Memory API](https://pages.cs.wisc.edu/~remzi/OSTEP/vm-api.pdf)
- **本讲要回答**：地址空间是什么／`malloc`/`free` 的语义／**为什么 free 之后那块内存还在那里**（不是清零，是交还）。
- **理解证据**：能区分程序看到的虚拟地址与实际物理位置，并说明释放内存不等于清零。

## 第 6 讲 · 地址翻译：硬件怎么帮我们作弊

- **核心疑问**：*谁能保证程序访问不到别人的内存？*
- **OSTEP 章节**：[ch15 Address Translation](https://pages.cs.wisc.edu/~remzi/OSTEP/vm-mechanism.pdf)｜[ch16 Segmentation](https://pages.cs.wisc.edu/~remzi/OSTEP/vm-segmentation.pdf)
- **本讲要回答**：基址+界限寄存器／**谁在做翻译**（硬件）／**谁在设规则**（操作系统）／分段为什么会出现、又为什么会碎。
- **理解证据**：能说明硬件如何执行地址翻译与访问限制，操作系统如何设置相关规则。

## 第 7 讲 · 分页与 TLB

- **核心疑问**：*页表那么大，为什么访问还这么快？*
- **OSTEP 章节**：[ch18 Introduction to Paging](https://pages.cs.wisc.edu/~remzi/OSTEP/vm-paging.pdf)｜[ch19 Translation Lookaside Buffers](https://pages.cs.wisc.edu/~remzi/OSTEP/vm-tlbs.pdf)
- **本讲要回答**：分页怎么解决碎片／页表存在哪／**TLB 为什么必须存在**（没有它每次访存要几次）／命中率与局部性的关系。
- **理解证据**：能解释 TLB 为什么能减少地址翻译的开销，以及局部性为何有利于命中率。

## 第 8 讲 · 换页：内存不够用的时候

- **核心疑问**：*内存不够时，先扔掉谁的页？*
- **OSTEP 章节**：[ch21 Swapping: Mechanisms](https://pages.cs.wisc.edu/~remzi/OSTEP/vm-beyondphys.pdf)｜[ch22 Swapping: Policies](https://pages.cs.wisc.edu/~remzi/OSTEP/vm-beyondphys-policy.pdf)
- **本讲要回答**：换出换入的机制／页错误处理流程／**LRU 的近似实现**（Clock 算法）／为什么"最优策略"只能当标尺。
- **理解证据**：能区分用未来信息定义的最优替换策略、LRU 的目标与实际近似实现。

## 第 9 讲 · 并发：两个线程同时改一个数

- **核心疑问**：*加一减一，为什么最后不是零？*
- **OSTEP 章节**：[ch26 Concurrency and Threads](https://pages.cs.wisc.edu/~remzi/OSTEP/threads-intro.pdf)
- **本讲要回答**：线程与进程的差别／**竞态条件**（`counter++` 不是原子的）／临界区的概念／**为什么结果不确定**。
- **理解证据**：能把 `counter++` 拆为读、修改、写等步骤，并说明交错执行为何会造成竞态；具体机器指令数不固定。

## 第 10 讲 · 锁：把混乱关进笼子

- **核心疑问**：*锁是怎么实现的？*
- **OSTEP 章节**：[ch28 Locks](https://pages.cs.wisc.edu/~remzi/OSTEP/threads-locks.pdf)｜[ch29 Locked Data Structures](https://pages.cs.wisc.edu/~remzi/OSTEP/threads-locks-usage.pdf)
- **本讲要回答**：`test-and-set` 为什么能当锁的基础／自旋锁的代价／**用锁保护一个数据结构，为什么比"加一把大锁"难得多**。
- **理解证据**：能说明锁需要硬件提供的原子操作作基础，并分析自旋及临界区范围的代价。

## 第 11 讲 · 条件变量与信号量

- **核心疑问**：*等一个条件，为什么不能忙等？*
- **OSTEP 章节**：[ch30 Condition Variables](https://pages.cs.wisc.edu/~remzi/OSTEP/threads-cv.pdf)｜[ch31 Semaphores](https://pages.cs.wisc.edu/~remzi/OSTEP/threads-sema.pdf)
- **本讲要回答**：为什么 `while` 而不是 `if` 包住 wait／信号量的两种用法（互斥 / 顺序）／**生产者-消费者为什么会死锁**。
- **理解证据**：能解释条件变量等待返回后为何必须重新检查条件，并区分信号量的两种常见用途。

## 第 12 讲 · 并发 bug 与事件驱动

- **核心疑问**：*死锁是怎么发生的？*
- **OSTEP 章节**：[ch32 Concurrency Bugs](https://pages.cs.wisc.edu/~remzi/OSTEP/threads-bugs.pdf)｜[ch33 Event-based Concurrency](https://pages.cs.wisc.edu/~remzi/OSTEP/threads-events.pdf)
- **本讲要回答**：非死锁缺陷（原子性违反 / 顺序违反）与死锁／**四个必要条件**／事件驱动为什么能绕开锁。
- **理解证据**：能用四个必要条件分析一个具体死锁案例，并与其他并发缺陷区分。

## 第 13 讲 · 文件与目录

- **核心疑问**：*一次 write 到底发生了什么？*
- **OSTEP 章节**：[ch39 Files and Directories](https://pages.cs.wisc.edu/~remzi/OSTEP/file-intro.pdf)｜[ch40 File System Implementation](https://pages.cs.wisc.edu/~remzi/OSTEP/file-implementation.pdf)
- **本讲要回答**：文件＝inode + 数据块／目录是什么（就是一个特殊的文件）／**从 `write()` 到磁盘要经过几层**。
- **理解证据**：能说明目录怎样把名字映射到文件元数据，并追踪一次写入涉及的主要步骤。

## 第 14 讲 · 崩溃之后：日志与一致性

- **核心疑问**：*断电那一刻，文件会不会坏？*
- **OSTEP 章节**：[ch42 FSCK and Journaling](https://pages.cs.wisc.edu/~remzi/OSTEP/file-journaling.pdf)｜[ch41 Fast File System](https://pages.cs.wisc.edu/~remzi/OSTEP/file-ffs.pdf)
- **本讲要回答**：一次更新要写多处 → 中途崩溃会留下什么／FSCK 怎么修／**日志（journaling）为什么能把"多处写"变成"一件事"**。
- **理解证据**：能说明一次多处写入为何可能在崩溃后不一致，以及日志如何帮助恢复。

---

## 排课与轮值

| 项 | 值 |
|---|---|
| 讲数 | **14** |
| 建议节奏 | 每周 1–2 讲 |
| 当课老师 | **鲸（DeepSeek 娘，全 14 讲）**；由 `runtime/progress.md` 排班确认。角色文件 `characters/deepseek.md` |
| 单元测验 | 每 4 讲一次（第 4、8、12、14 讲后） |

## 未纳入本轮的 OSTEP 章节（备查）

- **Ⅱ 剩余**：ch17 Free Space Management、ch20 Advanced Page Tables、ch23 Complete VM Systems
- **Ⅳ 剩余**：ch36 I/O Devices、ch37 Hard Disk Drives、ch38 RAID、ch43 LFS、ch44 Flash SSDs、ch45 Data Integrity
- **Ⅴ 分布式**：ch47–50（Dialogue / Distributed Systems / NFS / AFS）
- **Ⅵ 安全**：ch52–57（Dialogue / Intro / Authentication / Access Control / Cryptography / Distributed）
- **附录**：Virtual Machines、Monitors、Lab Tutorial、Systems Labs

→ 这些**不进 14 讲主线**；若某讲学生追问到，按"超纲是鼓励的"原则现场展开，并把结论回写到 `knowledge_points.md`。
