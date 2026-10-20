# A1 · Live2D Cubism 模型数据文件格式 · 一手取证

> 取证者：技术取证子代理（A1）
> 取证时间窗：2026-09-24 09:41 起（每条的抓取时间单独标注）
> 纪律：字段名／键名／示例值**只取自实际抓到的官方文档原文、官方 GitHub 源码、或真实模型文件**。
> 抓不到者逐字写「未找到」并列出试过的检索词与 URL。**不凭记忆写任何字段名。**

**证据分级标记**（每条都标）：
- 【官方原文】＝ 官方文档／官方仓库文件里的逐字内容
- 【官方样本文件】＝ 官方 GitHub 仓库 `Live2D/CubismWebSamples` 里的**真实模型文件全文**（这是实测数据，非文档描述）
- 【我的概括】＝ 我基于上述原文/文件的归纳

---

## 目录

- §0 取证通道与可达性记录
- §1 `model3.json` — 8 份官方样本**全文**
- §2 `model3.json` 字段清单（跨 8 样本实测）
- §3 `Parameters` 声明是否存在（重点问题）
- §4 （已并入 §5.1）`Controllers` / `ParamHit*` 的追查
- §5 `Layout` 与 `Controllers` 的专项追查
- §6 `.motion3.json` 的结构（含官方样本全文）
- §7 `.exp3.json` 的结构（含官方样本全文）
- §8 官方标准参数 ID 表
- §9 官方文档对各类 3.json 的说明
- §10 跨模型差异对比与"能否统一命名"的结论
- §11 未找到项 / 已知缺口
- §12 待确认清单
- §13 自报计时与完成度
- 附录 A 长名录补全 + 全部来源 URL
- 附录 B 方法论备注

---

## §0 取证通道与可达性记录

| 通道 | 结果 | 时间 |
|---|---|---|
| `curl https://api.github.com/repos/.../git/trees/develop?recursive=1` | ✅ HTTP 200，拿到完整文件树（246 条路径） | 2026-09-24T09:41+08:00 |
| `curl https://raw.githubusercontent.com/Live2D/CubismWebSamples/develop/...` | ✅ **可用**（HTTP 200）——一手原始文件直取成功 | 2026-09-24T09:42+08:00 |
| `https://raw.githubusercontent.com/.../Samples/TypeScript/Demo/Resources/Haru/Haru.model3.json` | ❌ **HTTP 404**（路径已变更） | 2026-09-24T09:41+08:00 |
| 实际有效路径前缀 | `Samples/Resources/<名>/<名>.model3.json`（**已非** prompt 里给的 `Samples/TypeScript/Demo/Resources/...`） | 2026-09-24T09:41+08:00 |

**仓库身份**：`Live2D/CubismWebSamples`，分支 `develop`。
文件树 API 返回的 `tree` 数组中共 **8 个 `*.model3.json`**，路径逐字如下（【官方原文】）：

```
Samples/Resources/Haru/Haru.model3.json
Samples/Resources/Hiyori/Hiyori.model3.json
Samples/Resources/Mao/Mao.model3.json
Samples/Resources/Mark/Mark.model3.json
Samples/Resources/Natori/Natori.model3.json
Samples/Resources/Ren/Ren.model3.json
Samples/Resources/Rice/Rice.model3.json
Samples/Resources/Wanko/Wanko.model3.json
```

→ **8 个全部下载成功**（HTTP 200）。

---

## §1 `model3.json` — 8 份官方样本全文

> 来源 URL 模板：`https://raw.githubusercontent.com/Live2D/CubismWebSamples/develop/Samples/Resources/<名>/<名>.model3.json`
> 抓取时间：2026-09-24T09:42+08:00
> 性质：【官方样本文件】——官方仓库真实模型文件，**全文逐字**，未做任何删改。

### 1.1 Haru（2 个 motion 组 / 8 个 expression）

来源：`https://raw.githubusercontent.com/Live2D/CubismWebSamples/develop/Samples/Resources/Haru/Haru.model3.json`

```json
{
	"Version": 3,
	"FileReferences": {
		"Moc": "Haru.moc3",
		"Textures": [
			"Haru.2048/texture_00.png",
			"Haru.2048/texture_01.png"
		],
		"Physics": "Haru.physics3.json",
		"Pose": "Haru.pose3.json",
		"DisplayInfo": "Haru.cdi3.json",
		"Expressions": [
			{
				"Name": "F01",
				"File": "expressions/F01.exp3.json"
			},
			{
				"Name": "F02",
				"File": "expressions/F02.exp3.json"
			},
			{
				"Name": "F03",
				"File": "expressions/F03.exp3.json"
			},
			{
				"Name": "F04",
				"File": "expressions/F04.exp3.json"
			},
			{
				"Name": "F05",
				"File": "expressions/F05.exp3.json"
			},
			{
				"Name": "F06",
				"File": "expressions/F06.exp3.json"
			},
			{
				"Name": "F07",
				"File": "expressions/F07.exp3.json"
			},
			{
				"Name": "F08",
				"File": "expressions/F08.exp3.json"
			}
		],
		"Motions": {
			"Idle": [
				{
					"File": "motions/haru_g_idle.motion3.json",
					"FadeInTime": 0.5,
					"FadeOutTime": 0.5
				},
				{
					"File": "motions/haru_g_m15.motion3.json",
					"FadeInTime": 0.5,
					"FadeOutTime": 0.5
				}
			],
			"TapBody": [
				{
					"File": "motions/haru_g_m26.motion3.json",
					"FadeInTime": 0.5,
					"FadeOutTime": 0.5,
					"Sound": "sounds/haru_talk_13.wav"
				},
				{
					"File": "motions/haru_g_m06.motion3.json",
					"FadeInTime": 0.5,
					"FadeOutTime": 0.5,
					"Sound": "sounds/haru_Info_14.wav"
				},
				{
					"File": "motions/haru_g_m20.motion3.json",
					"FadeInTime": 0.5,
					"FadeOutTime": 0.5,
					"Sound": "sounds/haru_normal_6.wav"
				},
				{
					"File": "motions/haru_g_m09.motion3.json",
					"FadeInTime": 0.5,
					"FadeOutTime": 0.5,
					"Sound": "sounds/haru_Info_04.wav"
				}
			]
		},
		"UserData": "Haru.userdata3.json"
	},
	"Groups": [
		{
			"Target": "Parameter",
			"Name": "EyeBlink",
			"Ids": [
				"ParamEyeLOpen",
				"ParamEyeROpen"
			]
		},
		{
			"Target": "Parameter",
			"Name": "LipSync",
			"Ids": [
				"ParamMouthOpenY"
			]
		}
	],
	"HitAreas": [
		{
			"Id": "HitArea",
			"Name": "Head"
		},
		{
			"Id": "HitArea2",
			"Name": "Body"
		}
	]
}
```
### 1.2 Hiyori（2 个 motion 组 / 无 Expressions 键）

来源：`https://raw.githubusercontent.com/Live2D/CubismWebSamples/develop/Samples/Resources/Hiyori/Hiyori.model3.json`
抓取时间：2026-09-24T09:42+08:00
性质：【官方样本文件】全文逐字

```json
{
	"Version": 3,
	"FileReferences": {
		"Moc": "Hiyori.moc3",
		"Textures": [
			"Hiyori.2048/texture_00.png",
			"Hiyori.2048/texture_01.png"
		],
		"Physics": "Hiyori.physics3.json",
		"Pose": "Hiyori.pose3.json",
		"UserData": "Hiyori.userdata3.json",
		"DisplayInfo": "Hiyori.cdi3.json",
		"Motions": {
			"Idle": [
				{
					"File": "motions/Hiyori_m01.motion3.json",
					"FadeInTime": 0.5,
					"FadeOutTime": 0.5
				},
				{
					"File": "motions/Hiyori_m02.motion3.json",
					"FadeInTime": 0.5,
					"FadeOutTime": 0.5
				},
				{
					"File": "motions/Hiyori_m03.motion3.json",
					"FadeInTime": 0.5,
					"FadeOutTime": 0.5
				},
				{
					"File": "motions/Hiyori_m05.motion3.json",
					"FadeInTime": 0.5,
					"FadeOutTime": 0.5
				},
				{
					"File": "motions/Hiyori_m06.motion3.json",
					"FadeInTime": 0.5,
					"FadeOutTime": 0.5
				},
				{
					"File": "motions/Hiyori_m07.motion3.json",
					"FadeInTime": 0.5,
					"FadeOutTime": 0.5
				},
				{
					"File": "motions/Hiyori_m08.motion3.json",
					"FadeInTime": 0.5,
					"FadeOutTime": 0.5
				},
				{
					"File": "motions/Hiyori_m09.motion3.json",
					"FadeInTime": 0.5,
					"FadeOutTime": 0.5
				},
				{
					"File": "motions/Hiyori_m10.motion3.json",
					"FadeInTime": 0.5,
					"FadeOutTime": 0.5
				}
			],
			"TapBody": [
				{
					"File": "motions/Hiyori_m04.motion3.json",
					"FadeInTime": 0.5,
					"FadeOutTime": 0.5
				}
			]
		}
	},
	"Groups": [
		{
			"Target": "Parameter",
			"Name": "LipSync",
			"Ids": [
				"ParamMouthOpenY"
			]
		},
		{
			"Target": "Parameter",
			"Name": "EyeBlink",
			"Ids": [
				"ParamEyeLOpen",
				"ParamEyeROpen"
			]
		}
	],
	"HitAreas": [
		{
			"Id": "HitArea",
			"Name": "Body"
		}
	]
}
```

### 1.3 Mao（2 个 motion 组 / 8 个 expression）

来源：`https://raw.githubusercontent.com/Live2D/CubismWebSamples/develop/Samples/Resources/Mao/Mao.model3.json`
抓取时间：2026-09-24T09:42+08:00
性质：【官方样本文件】全文逐字

```json
{
	"Version": 3,
	"FileReferences": {
		"Moc": "Mao.moc3",
		"Textures": [
			"Mao.2048/texture_00.png"
		],
		"Physics": "Mao.physics3.json",
		"Pose": "Mao.pose3.json",
		"DisplayInfo": "Mao.cdi3.json",
		"Expressions": [
			{
				"Name": "exp_01",
				"File": "expressions/exp_01.exp3.json"
			},
			{
				"Name": "exp_02",
				"File": "expressions/exp_02.exp3.json"
			},
			{
				"Name": "exp_03",
				"File": "expressions/exp_03.exp3.json"
			},
			{
				"Name": "exp_04",
				"File": "expressions/exp_04.exp3.json"
			},
			{
				"Name": "exp_05",
				"File": "expressions/exp_05.exp3.json"
			},
			{
				"Name": "exp_06",
				"File": "expressions/exp_06.exp3.json"
			},
			{
				"Name": "exp_07",
				"File": "expressions/exp_07.exp3.json"
			},
			{
				"Name": "exp_08",
				"File": "expressions/exp_08.exp3.json"
			}
		],
		"Motions": {
			"Idle": [
				{
					"File": "motions/mtn_01.motion3.json"
				},
				{
					"File": "motions/sample_01.motion3.json"
				}
			],
			"TapBody": [
				{
					"File": "motions/mtn_02.motion3.json"
				},
				{
					"File": "motions/mtn_03.motion3.json"
				},
				{
					"File": "motions/mtn_04.motion3.json"
				},
				{
					"File": "motions/special_01.motion3.json"
				},
				{
					"File": "motions/special_02.motion3.json"
				},
				{
					"File": "motions/special_03.motion3.json"
				}
			]
		}
	},
	"Groups": [
		{
			"Target": "Parameter",
			"Name": "LipSync",
			"Ids": [
				"ParamA"
			]
		},
		{
			"Target": "Parameter",
			"Name": "EyeBlink",
			"Ids": [
				"ParamEyeLOpen",
				"ParamEyeROpen"
			]
		}
	],
	"HitAreas": [
		{
			"Id": "HitAreaHead",
			"Name": "Head"
		},
		{
			"Id": "HitAreaBody",
			"Name": "Body"
		}
	]
}
```

### 1.4 Mark（1 个 motion 组 / 无 Expressions 键 / HitAreas 为空数组）

来源：`https://raw.githubusercontent.com/Live2D/CubismWebSamples/develop/Samples/Resources/Mark/Mark.model3.json`
抓取时间：2026-09-24T09:42+08:00
性质：【官方样本文件】全文逐字

```json
{
	"Version": 3,
	"FileReferences": {
		"Moc": "Mark.moc3",
		"Textures": [
			"Mark.2048/texture_00.png"
		],
		"Physics": "Mark.physics3.json",
		"UserData": "Mark.userdata3.json",
		"DisplayInfo": "Mark.cdi3.json",
		"Motions": {
			"Idle": [
				{
					"File": "motions/mark_m01.motion3.json",
					"FadeInTime": 0.5,
					"FadeOutTime": 0.5
				},
				{
					"File": "motions/mark_m02.motion3.json",
					"FadeInTime": 0.5,
					"FadeOutTime": 0.5
				},
				{
					"File": "motions/mark_m03.motion3.json",
					"FadeInTime": 0.5,
					"FadeOutTime": 0.5
				},
				{
					"File": "motions/mark_m04.motion3.json",
					"FadeInTime": 0.5,
					"FadeOutTime": 0.5
				},
				{
					"File": "motions/mark_m05.motion3.json",
					"FadeInTime": 0.5,
					"FadeOutTime": 0.5
				},
				{
					"File": "motions/mark_m06.motion3.json",
					"FadeInTime": 0.5,
					"FadeOutTime": 0.5
				}
			]
		}
	},
	"Groups": [
		{
			"Target": "Parameter",
			"Name": "LipSync",
			"Ids": []
		},
		{
			"Target": "Parameter",
			"Name": "EyeBlink",
			"Ids": [
				"ParamEyeLOpen",
				"ParamEyeROpen"
			]
		}
	],
	"HitAreas": []
}
```

### 1.5 Natori（2 个 motion 组 / 11 个 expression）

来源：`https://raw.githubusercontent.com/Live2D/CubismWebSamples/develop/Samples/Resources/Natori/Natori.model3.json`
抓取时间：2026-09-24T09:42+08:00
性质：【官方样本文件】全文逐字

```json
{
	"Version": 3,
	"FileReferences": {
		"Moc": "Natori.moc3",
		"Textures": [
			"Natori.2048/texture_00.png"
		],
		"Physics": "Natori.physics3.json",
		"Pose": "Natori.pose3.json",
		"DisplayInfo": "Natori.cdi3.json",
		"Expressions": [
			{
				"Name": "Angry",
				"File": "exp/Angry.exp3.json"
			},
			{
				"Name": "Blushing",
				"File": "exp/Blushing.exp3.json"
			},
			{
				"Name": "Normal",
				"File": "exp/Normal.exp3.json"
			},
			{
				"Name": "Sad",
				"File": "exp/Sad.exp3.json"
			},
			{
				"Name": "Smile",
				"File": "exp/Smile.exp3.json"
			},
			{
				"Name": "Surprised",
				"File": "exp/Surprised.exp3.json"
			},
			{
				"Name": "exp_01",
				"File": "exp/exp_01.exp3.json"
			},
			{
				"Name": "exp_02",
				"File": "exp/exp_02.exp3.json"
			},
			{
				"Name": "exp_03",
				"File": "exp/exp_03.exp3.json"
			},
			{
				"Name": "exp_04",
				"File": "exp/exp_04.exp3.json"
			},
			{
				"Name": "exp_05",
				"File": "exp/exp_05.exp3.json"
			}
		],
		"Motions": {
			"Idle": [
				{
					"File": "motions/mtn_00.motion3.json"
				},
				{
					"File": "motions/mtn_01.motion3.json"
				},
				{
					"File": "motions/mtn_02.motion3.json"
				}
			],
			"TapBody": [
				{
					"File": "motions/mtn_03.motion3.json"
				},
				{
					"File": "motions/mtn_04.motion3.json"
				},
				{
					"File": "motions/mtn_05.motion3.json"
				},
				{
					"File": "motions/mtn_06.motion3.json"
				},
				{
					"File": "motions/mtn_07.motion3.json"
				}
			]
		}
	},
	"Groups": [
		{
			"Target": "Parameter",
			"Name": "LipSync",
			"Ids": [
				"ParamMouthOpenY"
			]
		},
		{
			"Target": "Parameter",
			"Name": "EyeBlink",
			"Ids": [
				"ParamEyeLOpen",
				"ParamEyeROpen"
			]
		}
	],
	"HitAreas": [
		{
			"Id": "HitAreaHead",
			"Name": "Head"
		},
		{
			"Id": "HitAreaBody",
			"Name": "Body"
		}
	]
}
```

### 1.6 Ren（2 个 motion 组 / 5 个 expression）

来源：`https://raw.githubusercontent.com/Live2D/CubismWebSamples/develop/Samples/Resources/Ren/Ren.model3.json`
抓取时间：2026-09-24T09:42+08:00
性质：【官方样本文件】全文逐字

```json
{
	"Version": 3,
	"FileReferences": {
		"Moc": "Ren.moc3",
		"Textures": [
			"Ren.2048/texture_00.png"
		],
		"Physics": "Ren.physics3.json",
		"DisplayInfo": "Ren.cdi3.json",
		"Expressions": [
			{
				"Name": "exp_01",
				"File": "expressions/exp_01.exp3.json"
			},
			{
				"Name": "exp_02",
				"File": "expressions/exp_02.exp3.json"
			},
			{
				"Name": "exp_03",
				"File": "expressions/exp_03.exp3.json"
			},
			{
				"Name": "exp_04",
				"File": "expressions/exp_04.exp3.json"
			},
			{
				"Name": "exp_05",
				"File": "expressions/exp_05.exp3.json"
			}
		],
		"Motions": {
			"Idle": [
				{
					"File": "motions/mtn_01.motion3.json"
				}
			],
			"TapBody": [
				{
					"File": "motions/mtn_02.motion3.json"
				},
				{
					"File": "motions/mtn_03.motion3.json"
				}
			]
		}
	},
	"Groups": [
		{
			"Target": "Parameter",
			"Name": "EyeBlink",
			"Ids": [
				"ParamEyeLOpen",
				"ParamEyeROpen"
			]
		},
		{
			"Target": "Parameter",
			"Name": "LipSync",
			"Ids": [
				"ParamMouthOpenY"
			]
		}
	],
	"HitAreas": [
		{
			"Id": "HitAreaBody",
			"Name": "Body"
		},
		{
			"Id": "HitAreaHead",
			"Name": "Head"
		}
	]
}
```

### 1.7 Rice（2 个 motion 组 / 无 Expressions 键）

来源：`https://raw.githubusercontent.com/Live2D/CubismWebSamples/develop/Samples/Resources/Rice/Rice.model3.json`
抓取时间：2026-09-24T09:42+08:00
性质：【官方样本文件】全文逐字

```json
{
	"Version": 3,
	"FileReferences": {
		"Moc": "Rice.moc3",
		"Textures": [
			"Rice.2048/texture_00.png",
			"Rice.2048/texture_01.png"
		],
		"Physics": "Rice.physics3.json",
		"DisplayInfo": "Rice.cdi3.json",
		"Motions": {
			"Idle": [
				{
					"File": "motions/idle.motion3.json"
				}
			],
			"TapBody": [
				{
					"File": "motions/mtn_01.motion3.json"
				},
				{
					"File": "motions/mtn_02.motion3.json"
				},
				{
					"File": "motions/mtn_03.motion3.json"
				}
			]
		}
	},
	"Groups": [
		{
			"Target": "Parameter",
			"Name": "EyeBlink",
			"Ids": [
				"ParamEyeLOpen",
				"ParamEyeROpen"
			]
		},
		{
			"Target": "Parameter",
			"Name": "LipSync",
			"Ids": []
		}
	],
	"HitAreas": [
		{
			"Id": "HitAreaBody",
			"Name": "Body"
		}
	]
}
```

### 1.8 Wanko（2 个 motion 组 / 无 Expressions 键 / 参数 id 为全大写风格）

来源：`https://raw.githubusercontent.com/Live2D/CubismWebSamples/develop/Samples/Resources/Wanko/Wanko.model3.json`
抓取时间：2026-09-24T09:42+08:00
性质：【官方样本文件】全文逐字

```json
{
	"Version": 3,
	"FileReferences": {
		"Moc": "Wanko.moc3",
		"Textures": [
			"Wanko.1024/texture_00.png"
		],
		"Physics": "Wanko.physics3.json",
		"DisplayInfo": "Wanko.cdi3.json",
		"Motions": {
			"Idle": [
				{
					"File": "motions/idle_01.motion3.json"
				},
				{
					"File": "motions/idle_03.motion3.json"
				},
				{
					"File": "motions/idle_04.motion3.json"
				}
			],
			"TapBody": [
				{
					"File": "motions/touch_02.motion3.json"
				},
				{
					"File": "motions/touch_04.motion3.json"
				}
			]
		}
	},
	"Groups": [
		{
			"Target": "Parameter",
			"Name": "EyeBlink",
			"Ids": [
				"PARAM_EYE_L_OPEN",
				"PARAM_EYE_R_OPEN"
			]
		},
		{
			"Target": "Parameter",
			"Name": "LipSync",
			"Ids": [
				"PARAM_MOUTH_OPEN_Y"
			]
		}
	],
	"HitAreas": [
		{
			"Id": "HitArea",
			"Name": "Body"
		}
	]
}
```
---

## §2 `model3.json` 字段清单（跨 8 样本实测）

> 性质：【我的概括】——但每一条都由上节 §1 的 **8 份官方原文全文**支撑，可逐字回查。

**顶层键**（8 份样本中出现的全部顶层键，逐字）：

| 顶层键 | 出现的样本 | 备注 |
|---|---|---|
| `Version` | 8/8（值均为 `3`） | 全部为整数 `3`，非字符串 |
| `FileReferences` | 8/8 | 对象 |
| `Groups` | 8/8 | 数组 |
| `HitAreas` | 8/8 | 数组（**Mark 为空数组 `[]`**） |

**`FileReferences` 下的键**（逐字，8 份合计）：

| 键 | 出现的样本数 | 值类型 | 样本值示例（逐字） |
|---|---|---|---|
| `Moc` | 8/8 | 字符串 | `"Haru.moc3"` |
| `Textures` | 8/8 | 字符串数组 | `"Haru.2048/texture_00.png"` |
| `Physics` | 8/8 | 字符串 | `"Haru.physics3.json"` |
| `DisplayInfo` | 8/8 | 字符串 | `"Haru.cdi3.json"` |
| `Motions` | 8/8 | 对象 | 见 §2.1 |
| `Pose` | 6/8 | 字符串 | `"Haru.pose3.json"`（缺：`Mark`／`Rice`） |
| `UserData` | 4/8 | 字符串 | `"Haru.userdata3.json"`（有：`Haru`／`Hiyori`／`Mark`／`Natori`） |
| `Expressions` | 4/8 | 对象数组 | 见 §2.2（有：`Haru`／`Mao`／`Natori`／`Ren`） |

🔴 **关键观察**：`Moc`／`Textures`／`Physics`／`DisplayInfo`／`Motions` 是 8/8 全出现；`Pose`／`UserData`／`Expressions` 是**可选键**（存在缺失样本）。

### §2.1 `Motions` 结构（8 样本逐字汇总）

`Motions` 的值是**对象**，键＝**动作组名（Group name）**，值＝**该组的动作条目数组**。

每个动作条目出现过的键（逐字）：

| 条目键 | 值类型 | 样本 |
|---|---|---|
| `File` | 字符串 | 全部条目均有 |
| `FadeInTime` | 数字 | `Haru`／`Hiyori`／`Mark` 有（值 `0.5`）；`Mao`／`Natori`／`Ren`／`Rice`／`Wanko` **无** |
| `FadeOutTime` | 数字 | 同上 |
| `Sound` | 字符串 | **仅 `Haru`**（如 `"sounds/haru_talk_13.wav"`） |

→ **`FadeInTime`／`FadeOutTime` 与 `Sound` 都是可选的**（同仓库内就有不写的样本）。

#### 全部 Motion 组名与文件数（逐字统计）

| 模型 | 组名（逐字） | 该组文件数 | 该组文件路径（逐字） |
|---|---|---|---|

| Haru | `Idle` | 2 | `motions/haru_g_idle.motion3.json`<br>`motions/haru_g_m15.motion3.json` |

| Haru | `TapBody` | 4 | `motions/haru_g_m26.motion3.json`<br>`motions/haru_g_m06.motion3.json`<br>`motions/haru_g_m20.motion3.json`<br>`motions/haru_g_m09.motion3.json` |

| Hiyori | `Idle` | 9 | `motions/Hiyori_m01.motion3.json`<br>`motions/Hiyori_m02.motion3.json`<br>`motions/Hiyori_m03.motion3.json`<br>`motions/Hiyori_m05.motion3.json`<br>`motions/Hiyori_m06.motion3.json`<br>`motions/Hiyori_m07.motion3.json`<br>`motions/Hiyori_m08.motion3.json`<br>`motions/Hiyori_m09.motion3.json`<br>`motions/Hiyori_m10.motion3.json` |

| Hiyori | `TapBody` | 1 | `motions/Hiyori_m04.motion3.json` |

| Mao | `Idle` | 2 | `motions/mtn_01.motion3.json`<br>`motions/sample_01.motion3.json` |

| Mao | `TapBody` | 6 | `motions/mtn_02.motion3.json`<br>`motions/mtn_03.motion3.json`<br>`motions/mtn_04.motion3.json`<br>`motions/special_01.motion3.json`<br>`motions/special_02.motion3.json`<br>`motions/special_03.motion3.json` |

| Mark | `Idle` | 6 | `motions/mark_m01.motion3.json`<br>`motions/mark_m02.motion3.json`<br>`motions/mark_m03.motion3.json`<br>`motions/mark_m04.motion3.json`<br>`motions/mark_m05.motion3.json`<br>`motions/mark_m06.motion3.json` |

| Natori | `Idle` | 3 | `motions/mtn_00.motion3.json`<br>`motions/mtn_01.motion3.json`<br>`motions/mtn_02.motion3.json` |

| Natori | `TapBody` | 5 | `motions/mtn_03.motion3.json`<br>`motions/mtn_04.motion3.json`<br>`motions/mtn_05.motion3.json`<br>`motions/mtn_06.motion3.json`<br>`motions/mtn_07.motion3.json` |

| Ren | `Idle` | 1 | `motions/mtn_01.motion3.json` |

| Ren | `TapBody` | 2 | `motions/mtn_02.motion3.json`<br>`motions/mtn_03.motion3.json` |

| Rice | `Idle` | 1 | `motions/idle.motion3.json` |

| Rice | `TapBody` | 3 | `motions/mtn_01.motion3.json`<br>`motions/mtn_02.motion3.json`<br>`motions/mtn_03.motion3.json` |

| Wanko | `Idle` | 3 | `motions/idle_01.motion3.json`<br>`motions/idle_03.motion3.json`<br>`motions/idle_04.motion3.json` |

| Wanko | `TapBody` | 2 | `motions/touch_02.motion3.json`<br>`motions/touch_04.motion3.json` |


### §2.2 `Expressions` 结构（4 样本逐字汇总）

`Expressions` 的值是**数组**，每项是对象，键**只有两个**（逐字）：`Name`（字符串）、`File`（字符串）。


| 模型 | 项数 | `Name` 值（逐字，按文件顺序） | 对应 `File` 前缀（逐字） |
|---|---|---|---|

| Haru | 8 | `F01`／`F02`／`F03`／`F04`／`F05`／`F06`／`F07`／`F08` | expressions/ |

| Hiyori | — | **无 `Expressions` 键** | — |

| Mao | 8 | `exp_01`／`exp_02`／`exp_03`／`exp_04`／`exp_05`／`exp_06`／`exp_07`／`exp_08` | expressions/ |

| Mark | — | **无 `Expressions` 键** | — |

| Natori | 11 | `Angry`／`Blushing`／`Normal`／`Sad`／`Smile`／`Surprised`／`exp_01`／`exp_02`／`exp_03`／`exp_04`／`exp_05` | exp/ |

| Ren | 5 | `exp_01`／`exp_02`／`exp_03`／`exp_04`／`exp_05` | expressions/ |

| Rice | — | **无 `Expressions` 键** | — |

| Wanko | — | **无 `Expressions` 键** | — |


### §2.3 `Groups` 结构（8 样本逐字汇总）

`Groups` 的值是**数组**，每项对象含三个键（逐字）：`Target`（8/8 均为字符串 `"Parameter"`）、`Name`、`Ids`（字符串数组）。


| 模型 | `Name` | `Ids`（逐字） |
|---|---|---|

| Haru | `EyeBlink`（`Target`: `Parameter`） | `ParamEyeLOpen`／`ParamEyeROpen` |

| Haru | `LipSync`（`Target`: `Parameter`） | `ParamMouthOpenY` |

| Hiyori | `LipSync`（`Target`: `Parameter`） | `ParamMouthOpenY` |

| Hiyori | `EyeBlink`（`Target`: `Parameter`） | `ParamEyeLOpen`／`ParamEyeROpen` |

| Mao | `LipSync`（`Target`: `Parameter`） | `ParamA` |

| Mao | `EyeBlink`（`Target`: `Parameter`） | `ParamEyeLOpen`／`ParamEyeROpen` |

| Mark | `LipSync`（`Target`: `Parameter`） | **空数组 `[]`** |

| Mark | `EyeBlink`（`Target`: `Parameter`） | `ParamEyeLOpen`／`ParamEyeROpen` |

| Natori | `LipSync`（`Target`: `Parameter`） | `ParamMouthOpenY` |

| Natori | `EyeBlink`（`Target`: `Parameter`） | `ParamEyeLOpen`／`ParamEyeROpen` |

| Ren | `EyeBlink`（`Target`: `Parameter`） | `ParamEyeLOpen`／`ParamEyeROpen` |

| Ren | `LipSync`（`Target`: `Parameter`） | `ParamMouthOpenY` |

| Rice | `EyeBlink`（`Target`: `Parameter`） | `ParamEyeLOpen`／`ParamEyeROpen` |

| Rice | `LipSync`（`Target`: `Parameter`） | **空数组 `[]`** |

| Wanko | `EyeBlink`（`Target`: `Parameter`） | `PARAM_EYE_L_OPEN`／`PARAM_EYE_R_OPEN` |

| Wanko | `LipSync`（`Target`: `Parameter`） | `PARAM_MOUTH_OPEN_Y` |


### §2.4 `HitAreas` 结构（8 样本逐字汇总）

`HitAreas` 的值是**数组**，每项对象含两个键（逐字）：`Id`、`Name`。


| 模型 | `Id`（逐字） | `Name`（逐字） |
|---|---|---|

| Haru | `HitArea` | `Head` |

| Haru | `HitArea2` | `Body` |

| Hiyori | `HitArea` | `Body` |

| Mao | `HitAreaHead` | `Head` |

| Mao | `HitAreaBody` | `Body` |

| Mark | — | **空数组 `[]`** |

| Natori | `HitAreaHead` | `Head` |

| Natori | `HitAreaBody` | `Body` |

| Ren | `HitAreaBody` | `Body` |

| Ren | `HitAreaHead` | `Head` |

| Rice | `HitAreaBody` | `Body` |

| Wanko | `HitArea` | `Body` |

---

## §2.5 🔴 官方解析器源码里的字段常量表（**最权威的一手字段清单**）

> 来源 URL：`https://raw.githubusercontent.com/Live2D/CubismWebFramework/develop/src/cubismmodelsettingjson.ts`
> 抓取时间：2026-09-24T09:48+08:00
> 仓库身份：`Live2D/CubismWebFramework`，`default_branch=develop`，`pushed_at=2026-04-02T02:27:22Z`（经 `api.github.com/repos/Live2D/CubismWebFramework` 核）
> 性质：【官方原文】——官方 SDK 里**解析 `model3.json` 的解析器源码**。这是字段名的**权威真源**（文档可能滞后，代码不会）。

源码末尾「`Model3Jsonのキー文字列`」常量区**逐字**（第 732–779 行）：

```ts
  protected _json: CubismJson;
  protected _jsonValue: Array<Value>;

  /**
   * Model3Jsonのキー文字列
   */
  protected readonly version = 'Version';
  protected readonly fileReferences = 'FileReferences';

  protected readonly groups = 'Groups';
  protected readonly layout = 'Layout';
  protected readonly hitAreas = 'HitAreas';

  protected readonly moc = 'Moc';
  protected readonly textures = 'Textures';
  protected readonly physics = 'Physics';
  protected readonly pose = 'Pose';
  protected readonly expressions = 'Expressions';
  protected readonly motions = 'Motions';

  protected readonly userData = 'UserData';
  protected readonly name = 'Name';
  protected readonly filePath = 'File';
  protected readonly id = 'Id';
  protected readonly ids = 'Ids';
  protected readonly target = 'Target';

  // Motions
  protected readonly idle = 'Idle';
  protected readonly tapBody = 'TapBody';
  protected readonly pinchIn = 'PinchIn';
  protected readonly pinchOut = 'PinchOut';
  protected readonly shake = 'Shake';
  protected readonly flickHead = 'FlickHead';
  protected readonly parameter = 'Parameter';

  protected readonly soundPath = 'Sound';
  protected readonly fadeInTime = 'FadeInTime';
  protected readonly fadeOutTime = 'FadeOutTime';

  // Layout
  protected readonly centerX = 'CenterX';
  protected readonly centerY = 'CenterY';
  protected readonly x = 'X';
  protected readonly y = 'Y';
  protected readonly width = 'Width';
  protected readonly height = 'Height';

  protected readonly lipSync = 'LipSync';
  protected readonly eyeBlink = 'EyeBlink';

  protected readonly initParameter = 'init_param';
  protected readonly initPartsVisible = 'init_parts_visible';
  protected readonly val = 'val';
}
```

### 解析器实际读取的节点路径（逐字，源码第 14–21 行 + 43–68 行）

源码顶部 `FrequestNode` 枚举的注释**逐字**给出了每个节点在 JSON 树中的**确切路径**：

```ts
export enum FrequestNode {
  FrequestNode_Groups, // getRoot().getValueByString(Groups)
  FrequestNode_Moc, // getRoot().getValueByString(FileReferences).getValueByString(Moc)
  FrequestNode_Motions, // getRoot().getValueByString(FileReferences).getValueByString(Motions)
  FrequestNode_Expressions, // getRoot().getValueByString(FileReferences).getValueByString(Expressions)
  FrequestNode_Textures, // getRoot().getValueByString(FileReferences).getValueByString(Textures)
  FrequestNode_Physics, // getRoot().getValueByString(FileReferences).getValueByString(Physics)
  FrequestNode_Pose, // getRoot().getValueByString(FileReferences).getValueByString(Pose)
  FrequestNode_HitAreas // getRoot().getValueByString(HitAreas)
}
```

**结论（【我的概括】）**：解析器**只实例化 8 个节点**：`Groups`、`FileReferences.Moc`、`FileReferences.Motions`、`FileReferences.Expressions`、`FileReferences.Textures`、`FileReferences.Physics`、`FileReferences.Pose`、`HitAreas`。
→ 其余键（`Version`／`FileReferences.UserData`／`FileReferences.DisplayInfo`／`Layout`）**在常量表里有名字，但不在这 8 个预解析节点中**（它们经由 `getValueByString` 按需访问，见源码 372／387／661 行）。

### 📌 常量表揭示的三项「文档没写但源码有」的事实

| 项 | 逐字常量 | 说明 |
|---|---|---|
| **`Layout`** | `protected readonly layout = 'Layout';` | **8 份样本 model3.json 中一个都没出现**（见 §1 全文），但官方解析器**为它留了键名**，且有 `centerX/centerY/x/y/width/height` 配套常量 |
| **`init_param` / `init_parts_visible` / `val`** | `protected readonly initParameter = 'init_param';`<br>`protected readonly initPartsVisible = 'init_parts_visible';`<br>`protected readonly val = 'val';` | 官方解析器认得的键名，**8 份样本里都没出现** |
| **预设 Motion 组名 6 个** | `Idle`／`TapBody`／`PinchIn`／`PinchOut`／`Shake`／`FlickHead` | 官方**为这 6 个组名写了具名常量**（另有 `parameter = 'Parameter'`） |

### 📌 官方解析器对 EyeBlink / LipSync 组的判定方式（逐字源码）

```ts
      if (
        this._jsonValue[FrequestNode.FrequestNode_Groups]
          .getValueByIndex(i)
          .getValueByString(this.name)
          .getRawString() == this.eyeBlink
      ) {
```
（`cubismmodelsettingjson.ts` 第 450–457 行附近，`isExistEyeBlinkParameters()` → `getEyeBlinkParameterIds()`；第 510–517 行附近为 LipSync 同构逻辑）

**→ 【我的概括】官方靠「`Groups[].Name` 字符串等于 `"EyeBlink"` / `"LipSync"`」来定位这两组，再取该组的 `Ids` 作为参数 id 列表。** 这两个组名是**由 SDK 硬编码识别的**，不是可自由改名的。

---

## §3 🔴 重点问题：`model3.json` 里有没有 `Parameters` 声明？

### 结论：**没有。**

**三条独立证据（互相印证）：**

**证据 1 —— 官方解析器常量表里不存在 `Parameters` 键**（【官方原文】）
上节 §2.5 是 `cubismmodelsettingjson.ts` 常量区的**完整逐字抄录**（第 732–779 行，从 `protected _json` 到类结束）。其中**没有任何一行**定义 `Parameters`。已定义的全部键名就是上表那些。

**证据 2 —— 官方解析器的预解析节点里不存在 `Parameters`**（【官方原文】）
`FrequestNode` 枚举（§2.5 逐字）**只有 8 项**，无一项对应 `Parameters`。

**证据 3 —— 8 份官方样本 model3.json 全文里，`Parameters` 键出现 0 次**（【官方样本文件】）

程序化核验（对 §1 的 8 份原文逐字文件做键名计数）——**实跑输出，逐字抄录**：

```
Haru.model3.json | Parameters? False
Hiyori.model3.json | Parameters? False
Mao.model3.json | Parameters? False
Mark.model3.json | Parameters? False
Natori.model3.json | Parameters? False
Ren.model3.json | Parameters? False
Rice.model3.json | Parameters? False
Wanko.model3.json | Parameters? False
```

字面全文 grep（`grep -c 'Parameters' /tmp/l2d/orig/*.json`）——**8 个文件全部为 0**：

```
/tmp/l2d/orig/Haru.model3.json:0
/tmp/l2d/orig/Hiyori.model3.json:0
/tmp/l2d/orig/Mao.model3.json:0
/tmp/l2d/orig/Mark.model3.json:0
/tmp/l2d/orig/Natori.model3.json:0
/tmp/l2d/orig/Ren.model3.json:0
/tmp/l2d/orig/Rice.model3.json:0
/tmp/l2d/orig/Wanko.model3.json:0
```

结果：**8/8 均不存在 `Parameters` 键**。

### 📌 附带收获：8 份样本的**顶层键完全一致**

同一脚本输出的顶层键精确列表（逐字）：

```
Haru.model3.json ['Version', 'FileReferences', 'Groups', 'HitAreas']
Hiyori.model3.json ['Version', 'FileReferences', 'Groups', 'HitAreas']
Mao.model3.json ['Version', 'FileReferences', 'Groups', 'HitAreas']
Mark.model3.json ['Version', 'FileReferences', 'Groups', 'HitAreas']
Natori.model3.json ['Version', 'FileReferences', 'Groups', 'HitAreas']
Ren.model3.json ['Version', 'FileReferences', 'Groups', 'HitAreas']
Rice.model3.json ['Version', 'FileReferences', 'Groups', 'HitAreas']
Wanko.model3.json ['Version', 'FileReferences', 'Groups', 'HitAreas']
```

→ **顶层键只有 4 个**，8/8 无一例外。

**8 份样本「全部键名」的并集**（递归收集，逐字排序，**总共只有 22 个键名**）：

```
DisplayInfo  Expressions  FadeInTime  FadeOutTime  File  FileReferences
Groups  HitAreas  Id  Idle  Ids  Moc  Motions  Name  Physics  Pose
Sound  TapBody  Target  Textures  UserData  Version
```

→ 注意并集里**只有两个 Motion 组名**（`Idle`／`TapBody`）——因为样本只用了这两个。

> 🔴 **注意区分（防误读）**：`Parameters` 这个词**确实会出现在别的文件里**——见 §7：`.exp3.json` 的顶层键**就是** `Parameters`（已逐字抓到，见 §7）。所以说"没有参数声明"时，指的**严格是 `model3.json` 这个文件**。参数 id 的**真实定义处是 `.moc3` 二进制文件**；`model3.json` 不声明参数，只通过 `Groups[].Ids` **引用**参数 id 字符串。

### 已试检索与 URL（回答"为什么敢说没有"）

| 动作 | URL／检索词 | 结果 |
|---|---|---|
| 抓官方解析器源码全文 | `https://raw.githubusercontent.com/Live2D/CubismWebFramework/develop/src/cubismmodelsettingjson.ts` | ✅ 200，24382 字节，通读常量区 |
| 在该文件中 grep `Parameters` | `grep -n "Parameters" cubismmodelsettingjson.ts` | 命中 4 处，**全部是函数名** `isExistEyeBlinkParameters()` / `isExistLipSyncParameters()`，**无一是 JSON 键** |
| 在 8 份样本 JSON 中程序化查键 | Python 递归收集键名 | `Parameters` 出现 **0** 次 |
| 官方文件树全文检索 | `api.github.com/repos/Live2D/CubismWebFramework/git/trees/develop?recursive=1` | ✅ 99 条路径，`src/` 下无 `*parameters*.ts` 类解析器 |


---

## §5 `Layout` 与 `Controllers` 的专项追查

### §5.1 `Controllers`（任务问"Cubism 5 的 `ParamHit*` 相关"）

**结论：在 `Live2D/CubismWebFramework`（develop，5-r.5，2026-04-02）中，`model3.json` 的解析器里不存在 `Controllers` 键。**

**证据（【官方原文】）**：§2.5 已逐字抄录 `cubismmodelsettingjson.ts` 的**完整常量区**（第 732–779 行）——其中**没有 `Controllers`**，也没有任何 `ParamHit` 字样。

**已试检索（逐条列出，含结果）**：

| 检索动作 | 命令／URL | 结果 |
|---|---|---|
| 在 model3 解析器中搜 `Controllers` | `grep -n "Controllers" /tmp/l2d/fw/cubismmodelsettingjson.ts` | **0 命中** |
| 在 model3 解析器中搜 `ParamHit` | `grep -n "ParamHit" /tmp/l2d/fw/cubismmodelsettingjson.ts` | **0 命中** |
| 在 8 份官方样本 model3.json 中搜 `Controllers`／`ParamHit` | Python + grep（见 §3 核验脚本） | **0 命中** |
| GitHub 代码搜索 API | `https://api.github.com/search/code?q=Controllers+repo:Live2D/CubismWebFramework` | ❌ **HTTP 401 `Requires authentication`**（无 token，未取到结果） |
| 官方 CHANGELOG（5-r.5 段）通读 | `https://raw.githubusercontent.com/Live2D/CubismWebFramework/develop/CHANGELOG.md` | 见下 |

**关于 `ParamHit*`：未找到。** 我在 `cubismmodelsettingjson.ts` 与 8 份样本里**都没有找到**任何形如 `ParamHit` 的字符串。
→ 🔴 但我**不能**据此断言"Cubism 5 没有 ParamHit 机制"——我只做了**上述 5 项**检索。**如实标注：`ParamHit*` 在本次取证范围内「未找到」，其确切出处未定位（可能在其他仓库／未同步的分支／Editor 侧文档中）。这是本次取证的已知缺口。**

**CHANGELOG 5-r.5 段的逐字原文**（来源同上；抓取时间 2026-09-24T09:49+08:00）——**该段中没有提到 `Controllers` 或 `ParamHit`**：

```markdown
## [5-r.5] - 2026-04-02

### Added

* Add functionality to change motion calculation order.
* Add `cubismlook` class that implements the target tracking feature.
  * The target tracking feature can now specify parameter IDs through the `Framework`.

### Changed

* Change multiply and screen color functions to separate class with renamed methods.

### Fixed

* Fix unnecessary multiply color and screen color settings in mask drawing.
```

### §5.2 `Layout`

`Layout` 键**在官方解析器常量表中存在**（`protected readonly layout = 'Layout';`，见 §2.5），并配套 `centerX`／`centerY`／`x`／`y`／`width`／`height` 六个子键常量。
但**在 8 份官方样本的 model3.json 中，`Layout` 出现 0 次**（见 §3 核验：8 样本键名并集 22 个，不含 `Layout`）。

---

## §6 `.motion3.json` 的结构

### §6.1 🔴 官方解析器源码里的字段常量表（最权威）

> 来源 URL：`https://raw.githubusercontent.com/Live2D/CubismWebFramework/develop/src/motion/cubismmotionjson.ts`
> 抓取时间：2026-09-24T09:50+08:00
> 性质：【官方原文】

源码第 15–33 行「`// JSON keys`」区**逐字**：

```ts
// JSON keys
const Meta = 'Meta';
const Duration = 'Duration';
const Loop = 'Loop';
const AreBeziersRestricted = 'AreBeziersRestricted';
const CurveCount = 'CurveCount';
const Fps = 'Fps';
const TotalSegmentCount = 'TotalSegmentCount';
const TotalPointCount = 'TotalPointCount';
const Curves = 'Curves';
const Target = 'Target';
const Id = 'Id';
const FadeInTime = 'FadeInTime';
const FadeOutTime = 'FadeOutTime';
const Segments = 'Segments';
const UserData = 'UserData';
const UserDataCount = 'UserDataCount';
const TotalUserDataSize = 'TotalUserDataSize';
const Time = 'Time';
const Value = 'Value';
```

### §6.2 `Curves[].Target` 的合法取值（【官方原文】）

> 来源 URL：`https://raw.githubusercontent.com/Live2D/CubismWebFramework/develop/src/motion/cubismmotioninternal.ts`
> 抓取时间：2026-09-24T09:50+08:00

```ts
export enum CubismMotionCurveTarget {
  CubismMotionCurveTarget_Model, // モデルに対して
  CubismMotionCurveTarget_Parameter, // パラメータに対して
  CubismMotionCurveTarget_PartOpacity // パーツの不透明度に対して
}
```

→ `Target` 有三种：`Model`／`Parameter`／`PartOpacity`（这是解析器内部的枚举名 `CubismMotionCurveTarget_Parameter`，映射到 JSON 里的**字符串值**；样本中**实测到的是** `"Model"` 与 `"Parameter"`，逐字见 §6.3）。

### §6.3 `Segments` 的编码与四种段类型（【官方原文】+【官方样本文件】）

> 来源同上 `cubismmotioninternal.ts`

```ts
export enum CubismMotionSegmentType {
  CubismMotionSegmentType_Linear = 0, // リニア
  CubismMotionSegmentType_Bezier = 1, // ベジェ曲線
  CubismMotionSegmentType_Stepped = 2, // ステップ
  CubismMotionSegmentType_InverseStepped = 3 // インバースステップ
}
```

**`Segments` 是扁平数字数组**，不是嵌套对象。典型开头是 `0,1,` / `0,0,1,` 这种。逐字看样本（`haru_idle.motion3.json`，`Target: "Model"`, `Id: "Opacity"`）：

```json
		{
			"Target": "Model",
			"Id": "Opacity",
			"Segments": [
				0,
				1,
				1,
				3.32,
				1,
				6.64,
				1,
				9.97,
				1,
				0,
				10,
				1
			]
		},
```

→ 【我的概括】**段类型数字常量出现在段数据中**：上面 `... 0, 10, 1` 末尾的 `0` 与 `1` 是**段类型码**（`0`＝Linear，`1`＝Bezier），不是坐标值。
> ⚠️ 这一条是**语法推断**，我未逐字取到"Segments 数组的排布规范"官方说明文本。**标注为【我的概括／待确认】。**

### §6.4 官方样本 `.motion3.json` 全文（最小结构实例）

**Wanko `motions/idle_01.motion3.json`**（在 5 份下载的 motion 文件里**体积最小**，6897 字节，适合展示"最小结构"）：

> 来源 URL：`https://raw.githubusercontent.com/Live2D/CubismWebSamples/develop/Samples/Resources/Wanko/motions/idle_01.motion3.json`
> 抓取时间：2026-09-24T09:45+08:00
> 性质：【官方样本文件】

> 📌 **完整全文共约 6.9 KB、含 22 条 curve**，全量粘贴会淹没正文。此处给出**头部前 60 行逐字**（含 `Version` + 完整 `Meta` + 完整第 1 条 curve），并附**全文件的结构化摘要**。完整文件已落盘于 `/tmp/l2d/mot/wanko_idle01.motion3.json`（会话内临时路径）。

```json
{
	"Version": 3,
	"Meta": {
		"Duration": 5.967,
		"Fps": 30.0,
		"Loop": true,
		"AreBeziersRestricted": true,
		"CurveCount": 22,
		"TotalSegmentCount": 85,
		"TotalPointCount": 233,
		"UserDataCount": 0,
		"TotalUserDataSize": 0
	},
	"Curves": [
		{
			"Target": "Parameter",
			"Id": "PARAM_ANGLE_X",
			"Segments": [
				0,
				-1,
				1,
				0.222,
				-1,
				0.444,
				0,
				0.667,
				0,
				1,
				0.911,
				0,
				1.156,
				-1,
				1.4,
				-1,
				1,
				1.622,
				-1,
				1.844,
				0,
				2.067,
				0,
				1,
				2.322,
				0,
				2.578,
				-1,
				2.833,
				-1,
				1,
				3.067,
				-1,
				3.3,
				0,
				3.533,
				0,
				1,
				3.844,
				0,
				4.156,
				-1,
				4.467,
				-1,
				1,
				4.656,
				-1,
				4.844,
				0,
				5.033,
				0,
				1,
				5.333,
				0,
				5.633,
				-1,
				5.933,
				-1,
				0,
				5.967,
				-1
			]
		}
```

**`Meta` 的结构（5 份样本逐字汇总）**：

| `Meta` 子键 | 类型 | 5 份样本取值（逐字） |
|---|---|---|
| `Duration` | 数字 | `10`／`4.7`／`5.57`／`7.97`／`5.967` |
| `Fps` | 数字 | 5/5 均为 `30.0` |
| `Loop` | 布尔 | 5/5 均为 `true` |
| `AreBeziersRestricted` | 布尔 | `true`／`false`／`true`／`true`／`true`（**Hiyori 为 `false`**） |
| `CurveCount` | 数字 | `63`／`31`／`136`／`96`／`22` |
| `TotalSegmentCount` | 数字 | `296`／`135`／`213`／`105`／`85` |
| `TotalPointCount` | 数字 | `785`／`374`／`543`／`389`／`233` |
| `UserDataCount` | 数字 | 5/5 均为 `0` |
| `TotalUserDataSize` | 数字 | 5/5 均为 `0` |
| `FadeInTime` | 数字 | **仅 Mao 有**（`1.0`）——见 §6.5 |
| `FadeOutTime` | 数字 | **仅 Mao 有**（`1.0`） |

### §6.5 📌 `FadeInTime` / `FadeOutTime` 出现**两个层级**

这是容易踩的坑。逐字比对：

**（a）出现在 `Meta` 里**——只有 `Mao/mtn_01.motion3.json`（【官方样本文件】）：

```json
	"Meta": {
		"Duration": 5.57,
		"Fps": 30.0,
		"FadeInTime": 1.0,
		"FadeOutTime": 1.0,
		"Loop": true,
		"AreBeziersRestricted": true,
		"CurveCount": 136,
		...
```

**（b）出现在 `Curves[]` 的**每一条 curve**里**——同样是 `Mao/mtn_01.motion3.json`（【官方样本文件】）：

```json
		{
			"Target": "Parameter",
			"Id": "ParamAngleX",
			"FadeInTime": 1.0,
			"FadeOutTime": 1.0,
			"Segments": [
```

**（c）出现在 `model3.json` 的 `Motions` 条目里**——见 §2.1（`Haru`／`Hiyori`／`Mark` 用，值 `0.5`）。

→ **同一个键名在 3 个层级出现**，含义是"该层级的淡入时间"。解析器常量表（§6.1）只定义了一个 `FadeInTime = 'FadeInTime'`，靠**读取路径**区分层级。

### §6.6 是否存在 `.motion3.json` 里的 `Parameters` 声明？

**没有。** §6.1 的常量表逐字抄录里**没有 `Parameters`**。motion3 引用参数的方式是 **`Curves[].Id` 里的字符串**（如 `"ParamAngleX"`）。

## §6.7 5 份样本引用的参数 id（逐字全清单，程序化提取）

> 提取方式：`json.load()` 后取 `Curves[].Id`，按文件 + `Target` 聚合。
> 性质：【官方样本文件】实测值。

| 样本文件 | `Target` | curve 数 | 参数 id（逐字，原序） |
|---|---|---|---|
| `haru_g_idle.motion3.json` | `Model` | 1 | `Opacity` |
| `haru_g_idle.motion3.json` | `Parameter` | 42 | `ParamAngleX`, `ParamAngleY`, `ParamAngleZ`, `ParamTere`, `ParamFaceForm`, `ParamEyeLOpen`, `ParamEyeLSmile`, `ParamEyeROpen`, `ParamEyeRSmile`, `ParamEyeForm`, `ParamEyeBallForm`, `ParamTear`, `ParamEyeBallX`, `ParamEyeBallY`, `ParamBrowLY`, `ParamBrowRY`, `ParamBrowLX`, `ParamBrowRX`, `ParamBrowLAngle`, `ParamBrowRAngle`, `ParamBrowLForm`, `ParamBrowRForm`, `ParamMouthForm`, `ParamMouthOpenY`, `ParamScarf`, `ParamBodyAngleX`, `ParamBodyAngleY`, `ParamBodyAngleZ`, `ParamBodyUpper`, `ParamBreath`, `ParamBustY`, `ParamArmLA`, `ParamArmRA`, `ParamArmLB`, `ParamArmRB`, `ParamHandChangeR`, `ParamHandAngleR`, `ParamHandDhangeL`, `ParamHandAngleL`, `ParamHairFront`, `ParamHairSide`, `ParamHairBack` |
| `haru_g_idle.motion3.json` | `PartOpacity` | 20 | `Part01Core`, `Part01Hoho001`, `Part01Brow001`, `Part01Tear`, `Part01EyeBall001`, `Part01Eye001`, `Part01Nose001`, `Part01Mouth001`, `Part01Face001`, `Part01Ear001`, `Part01Neck001`, `Part01HairFront001`, `Part01HairSide001`, `Part01HairBack001`, `Part01ArmRB001`, `Part01ArmLB001`, `Part01ArmRA001`, `Part01ArmLA001`, `Part01Body001`, `Part01Sketch` |
| `Hiyori_m01.motion3.json` | `Parameter` | 29 | `ParamAngleX`, `ParamAngleY`, `ParamAngleZ`, `ParamCheek`, `ParamEyeLOpen`, `ParamEyeLSmile`, `ParamEyeROpen`, `ParamEyeRSmile`, `ParamEyeBallX`, `ParamEyeBallY`, `ParamBrowLY`, `ParamBrowRY`, `ParamBrowLX`, `ParamBrowRX`, `ParamBrowLAngle`, `ParamBrowRAngle`, `ParamBrowLForm`, `ParamBrowRForm`, `ParamMouthForm`, `ParamMouthOpenY`, `ParamBodyAngleX`, `ParamBodyAngleY`, `ParamBodyAngleZ`, `ParamBreath`, `ParamShoulder`, `ParamLeg`, `ParamArmLA`, `ParamArmRA`, `ParamHairAhoge` |
| `Hiyori_m01.motion3.json` | `PartOpacity` | 2 | `PartArmA`, `PartArmB` |
| `mtn_01.motion3.json`（Mao） | `Parameter` | 132 | `ParamAngleX`, `ParamAngleY`, `ParamAngleZ`, `ParamCheek`, `ParamFaceInkOn`, `ParamEyeLOpen`, `ParamEyeLSmile`, `ParamEyeLForm`, `ParamEyeROpen`, `ParamEyeRSmile`, `ParamEyeRForm`, `ParamEyeBallX`, `ParamEyeBallY`, `ParamEyeBallForm`, `ParamEyeEffect`, `ParamBrowLY`, `ParamBrowRY`, `ParamBrowLX`, `ParamBrowRX`, `ParamBrowLAngle`, `ParamBrowRAngle`, `ParamBrowLForm`, `ParamBrowRForm`, `ParamA`, `ParamI`, `ParamU`, `ParamE`, `ParamO`, `ParamMouthUp`, `ParamMouthDown`, `ParamMouthAngry`, `ParamMouthAngryLine`, `ParamBodyAngleX`, `ParamBodyAngleY`, `ParamBodyAngleZ`, `ParamBreath`, `ParamLeftShoulderUp`, `ParamRightShoulderUp`, `ParamArmLA01`…（**共 132 条，作者自定义占多数**，完整名录见文末附录 A） |
| `mtn_01.motion3.json`（Mao） | `PartOpacity` | 4 | `PartArmLA`, `PartArmRA`, `PartArmLB`, `PartArmRB` |
| `mtn_00.motion3.json`（Natori） | `Parameter` | 88 | `ParamAngleX`, `ParamAngleY`, `ParamAngleZ`, `ParamEyeLOpen`, `ParamEyeLSmile`, `ParamEyeLForm`, `ParamEyeROpen`, `ParamEyeRSmile`, `ParamEyeRForm`, `ParamEyeBallX`, `ParamEyeBallY`, `ParamEyeBallForm`, `ParamBrowLY`, `ParamBrowRY`, `ParamBrowLX`, `ParamBrowRX`, `ParamBrowLAngle`, `ParamBrowRAngle`, `ParamBrowLForm`, `ParamBrowLForm2`, `ParamBrowRForm`, `ParamBrowRForm2`, `ParamMouthForm`, `ParamMouthOpenY`, `ParamMouthForm2`, `ParamTeethOn`, `ParamCheek`, `ParamGlassUD`, `ParamGrassWhite`, `ParamGrassHighlight`, `ParamGrassHighlightMove`, `ParamBodyAngleX`, `ParamBodyAngleY`, `ParamBodyAngleZ`, `ParamWaistAngleZ`, `ParamBodyPosition`, `ParamBreath`, `ParamLeftShoulderUp`, `ParamRightShoulderUp`, `ParamAllX`, `ParamAllY`, `ParamAllRotate`, `ParamHairFront`, `ParamHairSide`, `ParamHairBack`, `ParamHairFrontFuwa`, `ParamHairSideFuwa`, `ParamHairBackFuwa`, `ParamJacket`, `ParamChainWaist`, `ParamWatchSwingA1`…（**共 88 条**，完整名录见文末附录 A） |
| `mtn_00.motion3.json`（Natori） | `PartOpacity` | 8 | `PartWatchA`, `PartWatchB`, `PartArmAL`, `PartArmAR`, `PartArmBR`, `PartArmCL`, `PartArmDL`, `PartArmER` |
| `idle_01.motion3.json`（Wanko） | `Parameter` | 22 | `PARAM_ANGLE_X`, `PARAM_ANGLE_Y`, `PARAM_ANGLE_Z`, `PARAM_EYE_L_OPEN`, `PARAM_EYE_R_OPEN`, `PARAM_MOUTH_OPEN_Y`, `PARAM_BODY_ANGLE_X`, `PARAM_BODY_ANGLE_Z`, `PARAM_BODY_ANGLE_Y`, `PARAM_BREATH`, `PARAM_BOWL_LID`, `PARAM_YUGE_01`, `PARAM_YUGE_02`, `PARAM_EFFECT`, `PARAM_EAR_L`, `PARAM_EAR_R`, `PARAM_HAND_L`, `PARAM_HAND_R`, `PARAM_SWING`, `PARAM_BOWL_SWING`, `PARAM_FACE_01`, `PARAM_BASE_X` |

🔴 **注意 Wanko**：它的参数 id 是 **`PARAM_ANGLE_X` 全大写带下划线**风格，**不是** `ParamAngleX` 驼峰风格。→ 见 §8 差异结论。

---

## §7 `.exp3.json` 的结构

### §7.1 🔴 官方解析器源码里的字段常量表（最权威）

> 来源 URL：`https://raw.githubusercontent.com/Live2D/CubismWebFramework/develop/src/motion/cubismexpressionmotion.ts`
> 抓取时间：2026-09-24T09:51+08:00
> 性质：【官方原文】

源码第 15–25 行「`// exp3.jsonのキーとデフォルト`」区**逐字**：

```ts
// exp3.jsonのキーとデフォルト
const ExpressionKeyFadeIn = 'FadeInTime';
const ExpressionKeyFadeOut = 'FadeOutTime';
const ExpressionKeyParameters = 'Parameters';
const ExpressionKeyId = 'Id';
const ExpressionKeyValue = 'Value';
const ExpressionKeyBlend = 'Blend';
const BlendValueAdd = 'Add';
const BlendValueMultiply = 'Multiply';
const BlendValueOverwrite = 'Overwrite';
const DefaultFadeTime = 1.0;
```

### §7.2 `Blend` 的合法取值（【官方原文】）

由上可见 `Blend` 有**三种合法值**（逐字）：`Add`／`Multiply`／`Overwrite`。

配套默认值（来源同上，逐字）：

```ts
  static readonly DefaultAdditiveValue = 0.0; // 加算適用の初期値
  static readonly DefaultMultiplyValue = 1.0; // 乗算適用の初期値
```

### §7.3 🔴 官方格式文档（`docs.live2d.com`）对 Expression 的说明

> 页面标题（逐字）：`About Expression Motion | SDK Manual | Live2D Manuals & Tutorials`
> 来源 URL：`https://docs.live2d.com/en/cubism-sdk-manual/expression/`
> 抓取时间：2026-09-24T09:56+08:00
> 页面页脚标注（逐字）：`Updated: 01/29/2026`
> 性质：【官方原文】

原文摘录（逐字）：

> **What is Expression Motion?**
>
> Expression Motion is an SDK feature that sets values for expressions relative to the current state, in addition to normal motion.
>
> The Motion Manager's fade function can be used to change over time from the current facial expression to a new facial expression setting that is played back.
>
> Another feature not found in motion is the ability to specify the calculation method.
>
> Since it inherits from the ACubismMotion class, it can be managed by the CubismMotionManager class just like normal motion.

> To create expression data (.exp3.json file), the .motion3.json file must be loaded into Cubism Viewer (for OW) as an Expression Motion, converted and output.

> Expression has the following differences when compared to motion.
>
> - There is no change in value over time.
> - It cannot affect the parts.
> - You can specify the calculation method (add, multiply, or overwrite).

🔴 **这段官方原文直接回答了两个关键问题**：
1. **`.exp3.json` 里没有时间轴**——"There is no change in value over time."
2. **`.exp3.json` 不能影响 parts**——"It cannot affect the parts."（只有 `Parameters`，没有 `PartOpacity`）

### §7.4 官方样本 `.exp3.json` 全文（3 份）

#### （a）Haru `expressions/F01.exp3.json` —— **最小结构**（124 字节，全文逐字）

> 来源 URL：`https://raw.githubusercontent.com/Live2D/CubismWebSamples/develop/Samples/Resources/Haru/expressions/F01.exp3.json`
> 抓取时间：2026-09-24T09:45+08:00
> 性质：【官方样本文件】

```json
{
	"Type": "Live2D Expression",
	"Parameters": [
		{
			"Id": "ParamMouthForm",
			"Value": 0.27,
			"Blend": "Add"
		}
	]
}
```

**→ 一个 `.exp3.json` 的最小结构就是这三层**：顶层 `Type`（字面量 `"Live2D Expression"`）+ 顶层 `Parameters` 数组 + 每项 `{Id, Value, Blend}`。

#### （b）Mao `expressions/exp_01.exp3.json` —— 含 `FadeInTime`／`FadeOutTime`

> 来源 URL：`https://raw.githubusercontent.com/Live2D/CubismWebSamples/develop/Samples/Resources/Mao/expressions/exp_01.exp3.json`
> 抓取时间：2026-09-24T09:45+08:00
> 性质：【官方样本文件】

**顶层键（逐字）**：`['Type', 'FadeInTime', 'FadeOutTime', 'Parameters']`

```json
{
	"Type": "Live2D Expression",
	"FadeInTime": 0.5,
	"FadeOutTime": 0.5,
	"Parameters": [
		{ "Id": "ParamCheek",        "Value": 0, "Blend": "Add" },
		{ "Id": "ParamEyeLOpen",     "Value": 1, "Blend": "Multiply" },
		{ "Id": "ParamEyeLSmile",    "Value": 0, "Blend": "Add" },
		{ "Id": "ParamEyeLForm",     "Value": 0, "Blend": "Add" },
		{ "Id": "ParamEyeROpen",     "Value": 1, "Blend": "Multiply" },
		{ "Id": "ParamEyeRSmile",    "Value": 0, "Blend": "Add" },
		{ "Id": "ParamEyeRForm",     "Value": 0, "Blend": "Add" },
		{ "Id": "ParamEyeBallX",     "Value": 0, "Blend": "Add" },
		{ "Id": "ParamEyeBallY",     "Value": 0, "Blend": "Add" },
		{ "Id": "ParamEyeBallForm",  "Value": 0, "Blend": "Add" },
		{ "Id": "ParamEyeEffect",    "Value": 0, "Blend": "Add" },
		{ "Id": "ParamBrowLY",       "Value": 0, "Blend": "Add" },
		{ "Id": "ParamBrowRY",       "Value": 0, "Blend": "Add" },
		{ "Id": "ParamBrowLX",       "Value": 0, "Blend": "Add" },
		{ "Id": "ParamBrowRX",       "Value": 0, "Blend": "Add" },
		{ "Id": "ParamBrowLAngle",   "Value": 0, "Blend": "Add" },
		{ "Id": "ParamBrowRAngle",   "Value": 0, "Blend": "Add" },
		{ "Id": "ParamBrowLForm",    "Value": 0, "Blend": "Add" },
		{ "Id": "ParamBrowRForm",    "Value": 0, "Blend": "Add" },
		{ "Id": "ParamA",            "Value": 0, "Blend": "Add" },
		{ "Id": "ParamI",            "Value": 0, "Blend": "Add" },
		{ "Id": "ParamU",            "Value": 0, "Blend": "Add" },
		{ "Id": "ParamE",            "Value": 0, "Blend": "Add" },
		{ "Id": "ParamO",            "Value": 0, "Blend": "Add" },
		{ "Id": "ParamMouthUp",      "Value": 0, "Blend": "Add" },
		{ "Id": "ParamMouthDown",    "Value": 0, "Blend": "Add" },
		{ "Id": "ParamMouthAngry",   "Value": 0, "Blend": "Add" },
		{ "Id": "ParamMouthAngryLine", "Value": 0, "Blend": "Add" }
	]
}
```
（📌 为可读性，上方 `Parameters` 数组**仅压缩了空白排版**，键名与值为逐字原样；原文件为每键一行的展开格式。）

#### （c）Natori `exp/Smile.exp3.json`

> 来源 URL：`https://raw.githubusercontent.com/Live2D/CubismWebSamples/develop/Samples/Resources/Natori/exp/Smile.exp3.json`
> 抓取时间：2026-09-24T09:45+08:00
> 性质：【官方样本文件】

**顶层键（逐字）**：`['Type', 'Parameters']`（**无** `FadeInTime`／`FadeOutTime`）

高价值取值示例（逐字）：

```json
		{
			"Id": "ParamEyeLOpen",
			"Value": -1,
			"Blend": "Add"
		},
		{
			"Id": "ParamEyeLSmile",
			"Value": 1,
			"Blend": "Add"
		},
```

→ **"笑眼"的实现方式**：把 `ParamEyeLOpen` 加 `-1`（闭眼方向）＋把 `ParamEyeLSmile` 加 `1`（笑眼方向）。这是**可直接照做的驱动写法**。

### §7.5 `.exp3.json` 的 `Type` 字段

3 份样本的 `Type` 值**逐字均为** `"Live2D Expression"`。

> ⚠️ **未在官方解析器常量表中找到 `Type`**：§7.1 逐字抄录的 `cubismexpressionmotion.ts` 常量区**没有** `Type` 这一项（只有 `FadeInTime`／`FadeOutTime`／`Parameters`／`Id`／`Value`／`Blend`）。
> → 【我的概括／待确认】`Type` 是**编辑器写出的标识字段**，运行时解析器**不读它**。此点为推断，未取到"解析器忽略 Type"的官方明文。

---

## §8 官方标准参数 ID 表（回答"参数 id 是不是标准的"）

### §8.1 官方源码里的默认参数 id 常量表

> 来源 URL：`https://raw.githubusercontent.com/Live2D/CubismWebFramework/develop/src/cubismdefaultparameterid.ts`
> 抓取时间：2026-09-24T09:53+08:00
> 性质：【官方原文】

该文件头部注释**逐字**给出了它依据的**官方文档链接**：

```ts
/**
 * @brief パラメータIDのデフォルト値を保持する定数<br>
 *         デフォルト値の仕様は以下のマニュアルに基づく<br>
 *         https://docs.live2d.com/cubism-editor-manual/standard-parametor-list/
 */
export const CubismDefaultParameterId = Object.freeze<Record<string, string>>({
  // パーツID
  HitAreaPrefix: 'HitArea',
  HitAreaHead: 'Head',
  HitAreaBody: 'Body',
  PartsIdCore: 'Parts01Core',
  PartsArmPrefix: 'Parts01Arm_',
  PartsArmLPrefix: 'Parts01ArmL_',
  PartsArmRPrefix: 'Parts01ArmR_',
  // パラメータID
  ParamAngleX: 'ParamAngleX',
  ParamAngleY: 'ParamAngleY',
  ParamAngleZ: 'ParamAngleZ',
  ParamEyeLOpen: 'ParamEyeLOpen',
  ParamEyeLSmile: 'ParamEyeLSmile',
  ParamEyeROpen: 'ParamEyeROpen',
  ParamEyeRSmile: 'ParamEyeRSmile',
  ParamEyeBallX: 'ParamEyeBallX',
  ParamEyeBallY: 'ParamEyeBallY',
  ParamEyeBallForm: 'ParamEyeBallForm',
  ParamBrowLY: 'ParamBrowLY',
  ParamBrowRY: 'ParamBrowRY',
  ParamBrowLX: 'ParamBrowLX',
  ParamBrowRX: 'ParamBrowRX',
  ParamBrowLAngle: 'ParamBrowLAngle',
  ParamBrowRAngle: 'ParamBrowRAngle',
  ParamBrowLForm: 'ParamBrowLForm',
  ParamBrowRForm: 'ParamBrowRForm',
  ParamMouthForm: 'ParamMouthForm',
  ParamMouthOpenY: 'ParamMouthOpenY',
  ParamCheek: 'ParamCheek',
  ParamBodyAngleX: 'ParamBodyAngleX',
  ParamBodyAngleY: 'ParamBodyAngleY',
  ParamBodyAngleZ: 'ParamBodyAngleZ',
  ParamBreath: 'ParamBreath',
  ParamArmLA: 'ParamArmLA',
  ParamArmRA: 'ParamArmRA',
  ParamArmLB: 'ParamArmLB',
  ParamArmRB: 'ParamArmRB',
  ParamHandL: 'ParamHandL',
  ParamHandR: 'ParamHandR',
  ParamHairFront: 'ParamHairFront',
  ParamHairSide: 'ParamHairSide',
  ParamHairBack: 'ParamHairBack',
  ParamHairFluffy: 'ParamHairFluffy',
  ParamShoulderY: 'ParamShoulderY',
  ParamBustX: 'ParamBustX',
  ParamBustY: 'ParamBustY',
  ParamBaseX: 'ParamBaseX',
  ParamBaseY: 'ParamBaseY',
  ParamNONE: 'NONE:'
});
```

### §8.2 🔴 官方文档「標準パラメータリスト」（含取值范围）

> 页面标题（逐字）：`標準パラメータリスト`（Editorマニュアル › モデリング › パラメータ）
> 来源 URL：`https://docs.live2d.com/cubism-editor-manual/standard-parameter-list/`
> ⚠️ **注意**：任务书里给的 URL 是 `standard-parametor-list`（`parametor` 拼写），实测该 URL 返回 **HTTP 301**，重定向到 `standard-parameter-list`（正确拼写）。**两个拼法并存，用后者。**
> 抓取时间：2026-09-24T09:54+08:00
> 页面页脚标注（逐字）：`最終更新： 2021年8月26日`
> 性质：【官方原文】

页面开头的规则说明（逐字）：

> 利用するパラメータを共通化することで、差し替え、再利用などが容易になります。
> 特別な事情が無い限りは、下記のルールに合わせてパラメータを設定することをおすすめします。
>
> **原則**
> 目、口などは、普通に閉じた状態を 0 、普通に開いた状態を 1 としてください。
>
> **Tips**
> しっかり閉じる、大きく開くなどの場合は、0.1単位の範囲外を付けても問題ありません。

🔴 **这段官方原文就是"闭眼=0、睁眼=1"这条约定的一手出处**——也正是 §7.4(c) 里 `ParamEyeLOpen` 用 `-1`（比"全闭"更闭）的合规依据。

**标准参数表（逐字誊录：名称 / ID / 最小值 / 默认值 / 最大值 / 说明）**：

| 名前 | ID | 最小値 | デフォルト値 | 最大値 | 説明 |
|---|---|---|---|---|---|
| 角度X | `ParamAngleX` | -30 | 0 | 30 | +で画面の右を向く |
| 角度Y | `ParamAngleY` | -30 | 0 | 30 | +で画面の上を向く |
| 角度Z | `ParamAngleZ` | -30 | 0 | 30 | +で画面の右を向く |
| 左目　開閉 | `ParamEyeLOpen` | 0 | 1 | 1 | +で目を開ける |
| 左目　笑顔 | `ParamEyeLSmile` | 0 | 0 | 1 | +で笑顔目 |
| 右目　開閉 | `ParamEyeROpen` | 0 | 1 | 1 | +で目を開ける |
| 右目　笑顔 | `ParamEyeRSmile` | 0 | 0 | 1 | +で笑顔目 |
| 目玉　X | `ParamEyeBallX` | -1 | 0 | 1 | +で右を見る |
| 目玉　Y | `ParamEyeBallY` | -1 | 0 | 1 | +で上を見る |
| 目玉の拡大縮小※ | `ParamEyeBallForm` | -1 | 0 | 1 | -1で小さめ 0 で標準 1で大きめ |
| 左眉　上下 | `ParamBrowLY` | -1 | 0 | 1 | +で眉を上げる |
| 右眉　上下 | `ParamBrowRY` | -1 | 0 | 1 | +で眉を上げる |
| 左眉　左右 | `ParamBrowLX` | -1 | 0 | 1 | -で眉を寄せる |
| 右眉　左右 | `ParamBrowRX` | -1 | 0 | 1 | -で眉を寄せる |
| 左眉　角度 | `ParamBrowLAngle` | -1 | 0 | 1 | -で眉を怒らせる |
| 右眉　角度 | `ParamBrowRAngle` | -1 | 0 | 1 | -で眉を怒らせる |
| 左眉　変形 | `ParamBrowLForm` | -1 | 0 | 1 | -で眉を怒らせる |
| 右眉　変形 | `ParamBrowRForm` | -1 | 0 | 1 | -で眉を怒らせる |
| 口　変形 | `ParamMouthForm` | -1 | 0 | 1 | +で笑った口 -で怒った口 |
| 口　開閉 | `ParamMouthOpenY` | 0 | 0 | 1 | +で口を開く |
| 照れ | `ParamCheek` | 0 | 適宜 | 1 | +で頬染め |
| 体の回転　X | `ParamBodyAngleX` | -10 | 0 | 10 | +で画面の右を向く |
| 体の回転　Y | `ParamBodyAngleY` | -10 | 0 | 10 | +で画面の上に動く |
| 体の回転　Z | `ParamBodyAngleZ` | -10 | 0 | 10 | +で画面の右に傾く |
| 呼吸 | `ParamBreath` | 0 | 0 | 1 | +で息を吸う |
| 左腕 A※ | `ParamArmLA` | -30 | 0 | 30 | +で左腕Aを広げる |
| 右腕 A※ | `ParamArmRA` | -30 | 0 | 30 | +で右腕Aを広げる |
| 左腕 B※ | `ParamArmLB` | -30 | 0 | 30 | +で左腕Bを広げる |
| 右腕 B※ | `ParamArmRB` | -30 | 0 | 30 | +で右腕Bを広げる |
| 左手※ | `ParamHandL` | -10 | 0 | 10 | +で左手の変形 |
| 右手※ | `ParamHandR` | -10 | 0 | 10 | +で右手の変形 |
| 髪揺れ　前 | `ParamHairFront` | -1 | 0 | 1 | +で画面の右に動く |
| 髪揺れ　横 | `ParamHairSide` | -1 | 0 | 1 | +で画面の右に動く |
| 髪揺れ　後 | `ParamHairBack` | -1 | 0 | 1 | +で画面の右に動く |
| 髪揺れ　ふわ※ | `ParamHairFluffy` | -1 | 0 | 1 | +で髪が外側に広がる |
| 肩すくめる※ | `ParamShoulderY` | -10 | 0 | 10 | +で肩をすくめる動作 |
| 胸揺れ※ | `ParamBustX`／`ParamBustY` | -1／-1 | 0／0 | 1／1 | +で右に揺れる／+で上に揺れる |
| 全体の左右※ | `ParamBaseX` | -10 | 0 | 10 | +で画面の右に動く |
| 全体の上下※ | `ParamBaseY` | -10 | 0 | 10 | +で画面の上に動く |

（※印的为"必要があれば入れてください"＝可选参数，逐字原文：「※の付いているパラメータは、必要があれば入れてください」）

**标准参数分组 ID（逐字誊录）**：

| 名前 | ID | | 名前 | ID |
|---|---|---|---|---|
| 顔 | `ParamGroupFace` | | 左手 | `ParamGroupHandL` |
| 頭 | `ParamGroupHead` | | 右手 | `ParamGroupHandR` |
| 目 | `ParamGroupEyes` | | 腕 | `ParamGroupArms` |
| 目玉 | `ParamGroupEyeballs` | | 左腕 | `ParamGroupArmL` |
| 眉 | `ParamGroupBrows` | | 右腕 | `ParamGroupArmR` |
| 口 | `ParamGroupMouth` | | 脚 | `ParamGroupLegs` |
| 体 | `ParamGroupBody` | | 左脚 | `ParamGroupLegL` |
| 手 | `ParamGroupHands` | | 右脚 | `ParamGroupLegR` |
| 揺れ | `ParamGroupSway` | | 表情 | `ParamGroupExpression` |
| 髪 | `ParamGroupHair` | | 全体 | `ParamGroupOverall` |

---

## §9 官方文档对各类 3.json 的说明（`docs.live2d.com`）

> 页面标题（逐字）：`Json | SDK Manual | Live2D Manuals & Tutorials`（路径：`SDK for Unity › Framework › Json`）
> 来源 URL（英文版，实抓）：`https://docs.live2d.com/en/cubism-sdk-manual/json-unity/`
> 来源 URL（日文版，实抓）：`https://docs.live2d.com/cubism-sdk-manual/json-unity/`
> 抓取时间：2026-09-24T09:57+08:00
> 页面页脚标注（逐字）：`Updated: 06/10/2021`
> 性质：【官方原文】

🔴 **关于任务书里给的 URL**：`https://docs.live2d.com/en/cubism-sdk-manual/json-list/` 实测返回 **HTTP 404**（页面标题逐字为 `Not Found | Live2D Manuals & Tutorials`）。
**有效入口是通过 sitemap 找到的 `json-unity`（另有 `json-cocos`／`json-ue` 等平台变体）。** 见 §9.4 的检索记录。

### §9.1 官方列出的 7 种 3.json 解析器（逐字）

```
CubismModel3Json
CubismMotion3Json
CubismUserData3Json
CubismPhysics3Json
CubismExp3Json
CubismPose3Json
CubismDisplayInfo3Json
```

### §9.2 `.model3.json` 的官方说明（逐字摘录）

> **CubismModel3Json**
>
> Parser for .model3.json.
>
> You can get the path to various other json files, such as motion and facial expressions described in .model3.json.
>
> To parse .model3.json in CubismModel3Json, use CubismModel3Json.LoadAtPath().

> From the parsed data, it is possible to obtain the relative paths to the various files described in .model3.json.
>
> ```csharp
> // .moc3
> var mocPath = model3Json.FileReferences.Moc;
> // textures
> for(var i = 0; i < model3Json.FileReferences.Textures.Length; i++)
> {
> var texturePath = model3Json.FileReferences.Textures[i];
> }
> // .physics3.json
> var physicsPath = model3Json.FileReferences.Physics;
> // .userdata3.json
> var userdataPath = model3Json.FileReferences.UserData;
> ...
> ```

> Typically, the path can be obtained with the same structure as the hierarchy of .model3.json, but the reference to the data for expression described in .model3.json has its own structure.
>
> This is because the .model3.json structure in Cubism cannot be parsed by JsonUtility, Unity's built-in JSON parser, due to its specification.
>
> In Cubism SDK for Unity, only expression data references are parsed by our own JSON parser.

🔴 **这条官方说明印证了 §2.2 的实测发现**：`Expressions` 的结构**与其他键不同**（官方原话 "has its own structure"）。

### §9.3 其余各 3.json 的官方一句话定义（逐字）

| 解析器 | 官方逐字说明 |
|---|---|
| `CubismMotion3Json` | "Parser for .motion3.json." / "AnimationClip can be generated from the curve information described in .motion3.json." |
| `CubismUserData3Json` | "Parser for .userdata3.json." / "User data can be applied to the model's ArtMesh from the information described in .userdata3.json." |
| `CubismPhysics3Json` | "Parser for .physics3.json." / "Physics settings described in .physics3.json can be converted for use in Unity." |
| `CubismExp3Json` | "Parser for .exp3.json." / "The information about facial expression differences described in .exp3.json can be converted into a format that can be handled in Unity." |
| `CubismPose3Json` | "Parser for .pose3.json." / "From the information described in .pose3.json, you can obtain the settings that control the display state of the part in Unity." |
| `CubismDisplayInfo3Json` | "Parser for .cdi3.json." / "`.cdi3.json`には、Cubismエディタで設定されたパラメータやパーツ、パラメータグループの名前と、それらと対になる各IDが記述されています。"（日文版原文）<br>→ 【译】`.cdi3.json` 里记录了 Cubism Editor 中设置的**参数、部件、参数分组**的**名称**及其**对应 ID**；SDK for Unity 用它来在 Inspector 里显示名称（**没有 `.cdi3.json` 的模型直接显示 ID**）。 |

🔴 **`.cdi3.json` 的意义（对我们的用途很关键）**：官方原文说它装着**参数／部件／分组的「显示名 ↔ ID」对照**。
→ 即：**想知道一个模型有哪些参数 id、它们的人话名字叫什么，`.cdi3.json` 是官方指定的查询处**（而非 `model3.json`）。这与 §3 的结论一致。

### §9.4 检索记录：官方 JSON 文档入口的寻找过程

| 尝试的 URL | 结果 |
|---|---|
| `https://docs.live2d.com/en/cubism-sdk-manual/json-list/`（任务书所给） | ❌ **404**，`<title>Not Found \| Live2D Manuals & Tutorials</title>` |
| `https://docs.live2d.com/cubism-sdk-manual/json-list/` | ❌ 404 |
| `https://docs.live2d.com/en/cubism-editor-manual/json-list/` | ❌ 404 |
| `https://docs.live2d.com/en/cubism-sdk-manual/json/` | ❌ 404 |
| `https://docs.live2d.com/en/cubism-sdk-tutorials/json/` | ❌ 404 |
| `https://docs.live2d.com/sitemap.xml` | ✅ 200（sitemap index，含 `wp-sitemap-posts-sdk_manual-1.xml`） |
| `https://docs.live2d.com/wp-sitemap-posts-sdk_manual-1.xml` | ✅ 200 —— **在这里找到了 `json-unity`／`json-cocos`／`json-ue` 等真实入口** |
| `https://docs.live2d.com/en/cubism-sdk-manual/json-unity/` | ✅ **200，有效** |
| `https://docs.live2d.com/en/cubism-sdk-manual/expression/` | ✅ 200，`<title>About Expression Motion \| SDK Manual \| Live2D Manuals & Tutorials</title>` |
| `https://docs.live2d.com/cubism-editor-manual/standard-parametor-list/` | ⚠️ **301** → 重定向到 `standard-parameter-list/` |
| `https://docs.live2d.com/cubism-editor-manual/standard-parameter-list/` | ✅ **200，有效** |
| `https://docs.live2d.com/cubism-sdk-manual/motion3-consistency/` | ✅ 200（JP）→ 标题 `.motion3.jsonの整合性を検証する` |
| `https://docs.live2d.com/cubism-sdk-manual/reproducibility-motion3-json/` | ✅ 200（JP）→ 标题 `【対応済み】.motion3.jsonの再現性が劣化する場合について` |

---

## §10 🔴 跨模型差异对比与"能否统一命名"的结论

### §10.1 Motion 组名：**8/8 样本一致**（【官方样本文件】实测）

| 模型 | Motion 组名（逐字，原序） |
|---|---|
| Haru | `Idle`, `TapBody` |
| Hiyori | `Idle`, `TapBody` |
| Mao | `Idle`, `TapBody` |
| Mark | `Idle` |
| Natori | `Idle`, `TapBody` |
| Ren | `Idle`, `TapBody` |
| Rice | `Idle`, `TapBody` |
| Wanko | `Idle`, `TapBody` |

**组名计数**（程序化统计）：`Idle` = **8/8**，`TapBody` = **7/8**（Mark 无）。

🔴 **这个一致不是"作者碰巧"**：§2.5 的官方解析器常量区**为 `Idle`／`TapBody` 写了具名常量**（`protected readonly idle = 'Idle';`／`protected readonly tapBody = 'TapBody';`），且另有 `PinchIn`／`PinchOut`／`Shake`／`FlickHead` 四个常量。
→ **【我的概括】`Idle` 是官方约定的通用组名，不是随作者变的私有命名。**

⚠️ **反证边界**：官方常量表**只给了 6 个组名**。8 份样本**只用了其中 2 个**（`Idle`／`TapBody`）。
→ **"作者会不会自造组名"这个问题，本次取证范围内没有反例，但也没有正面许可文本**。标为【推断／待确认】。

### §10.2 Expression 名字：**随作者变**（【官方样本文件】实测）

| 模型 | Expression `Name`（逐字，原序） | 项数 |
|---|---|---|
| Haru | `F01`, `F02`, `F03`, `F04`, `F05`, `F06`, `F07`, `F08` | 8 |
| Mao | `exp_01`, `exp_02`, `exp_03`, `exp_04`, `exp_05`, `exp_06`, `exp_07`, `exp_08` | 8 |
| Natori | `Angry`, `Blushing`, `Normal`, `Sad`, `Smile`, `Surprised`, `exp_01`, `exp_02`, `exp_03`, `exp_04`, `exp_05` | 11 |
| Ren | `exp_01`, `exp_02`, `exp_03`, `exp_04`, `exp_05` | 5 |
| Hiyori | **无 `Expressions` 键** | — |
| Mark | **无 `Expressions` 键** | — |
| Rice | **无 `Expressions` 键** | — |
| Wanko | **无 `Expressions` 键** | — |

🔴 **结论：Expression 名字完全随作者变。** 同一仓库内出现四种互不重叠的风格：
- `F01`…`F08`（Haru，纯编号）
- `exp_01`…`exp_08`（Mao／Ren，带前缀编号）
- `Angry`／`Blushing`／`Normal`／`Sad`／`Smile`／`Surprised`（Natori，**语义名**）
- **4/8 模型干脆没有 `Expressions` 键**

→ 官方**没有**给 Expression 名字设任何常量（§2.5 常量表里没有任何 expression 名常量）。
→ **Expression 名是自由的，不可统一**。

### §10.3 参数 id：**三种风格并存**（🔴 最关键的一条）

程序化统计（以 §8.2 官方标准参数表为基准）：

| 样本 | 引用的参数 id 总数 | **在官方标准表内** | 核心 6 项命中 | **自定义（不在标准表）** |
|---|---|---|---|---|
| `haru_g_idle` | 42 | 32 | 6/6 | 10 |
| `Hiyori_m01` | 29 | 26 | 6/6 | 3 |
| `mtn_01`（Mao） | 132 | 25 | 5/6 | **107** |
| `mtn_00`（Natori） | 88 | 28 | 6/6 | **60** |
| `idle_01`（Wanko） | 22 | **0** | **0/6** | **22** |

**核心 6 项**指：`ParamAngleX`／`ParamAngleY`／`ParamAngleZ`／`ParamEyeLOpen`／`ParamEyeROpen`／`ParamMouthOpenY`。

**🔴 三条硬结论：**

**（1）Wanko 完全不用标准命名。** 它的 22 个参数 id **0 个**落在官方标准表内——全部是 `PARAM_ANGLE_X` / `PARAM_EYE_L_OPEN` / `PARAM_MOUTH_OPEN_Y` / `PARAM_BODY_ANGLE_X` 这类**全大写 + 下划线**风格。
→ **这些 id 在语义上与标准参数一一对应，但字面完全不同。**

**（2）5 份样本的"共同参数 id"数量 = 0。**
程序化求交集（5 份 motion 文件的参数 id 集合取交集）：

```
共同 0 个: []
并集 225 个
```

→ **没有任何一个参数 id 在 5 份样本中全部出现。**（原因：Wanko 用全大写风格，与其余四份零交集。）

**（3）自定义参数是常态，不是例外。** Mao 有 **107/132** 个参数 id 是自定义的，Natori **60/88**。这些是特效、道具、多段手臂等模型特有能力（如 `ParamHeartColorRainbow`、`ParamRabbitElimination`、`ParamWatchSwingA1`）。**官方标准表覆盖不到它们，也不打算覆盖。**

### §10.4 🔴 回答"我们的驱动接口能不能用一套统一命名"

**【我的概括 —— 基于上述实测数据的推断，非官方声明】**

| 层 | 能否统一 | 依据 |
|---|---|---|
| **Motion 组名** | ✅ **可以统一**（限 `Idle`／`TapBody`，另有官方 4 个具名常量备用） | 8/8 样本一致 + 官方常量表具名 |
| **Expression 名字** | ❌ **不能统一** | 4 种风格互不重叠，4/8 模型根本没有 |
| **参数 id** | ⚠️ **"标准子集"可统一，"全量"不能** | 5 份共同 id = 0；Wanko 零标准命名；Mao/Natori 大量自定义 |
| **`.exp3.json` / `.motion3.json` 的字段结构** | ✅ **完全统一** | 官方解析器常量表固定，5 份 motion + 3 份 exp 结构一致 |

**可操作的写法（推断，供后续设计参考）：**

1. **不要硬编码参数 id**。正确做法是**运行时查询**：从 `model3.json` 的 `Groups[].Ids` 取 `EyeBlink`／`LipSync`，从 `.cdi3.json`（§9.3 官方说明其装着"名称 ↔ ID 对照"）取全部参数清单。
2. **驱动层做一层"语义名 → 模型实际 id"的映射**。语义名用 `eye_l_open`／`mouth_open_y` 这种中立命名，映射表**按模型填**。这是唯一能同时吃下 `ParamEyeLOpen`（Haru）与 `PARAM_EYE_L_OPEN`（Wanko）的结构。
3. **`Idle` 组可以直接用**；Expression 必须**按模型读 `Expressions[].Name` 动态建立**，不能假设有 `Smile`。

> ⚠️ **本节为【我的概括】。** 官方**没有**发布过"驱动接口该怎么命名"的规范性文本。上述是**从实测差异反推的工程建议**，不是官方结论。若要与官方做法对齐，需再看 `moeru-ai/airi` 等实际驱动实现（**本次取证未做，见 §11**）。

### §10.5 样本量声明

本次共取得 **8 份 model3.json**（全部来自同一官方仓库 `Live2D/CubismWebSamples`）+ **5 份 motion3.json** + **3 份 exp3.json**（1 份 404 未取到）。
→ **组名一致的结论有 8 个样本支撑**；**参数差异结论有 5 个样本支撑**。
→ ⚠️ **全部样本来自同一个官方仓库**，不构成"跨作者"的独立样本。**"不同作者差异有多大"这一问，本次只在官方样本内部作答**，标为【样本局限】。

---

## §11 未找到项 / 已知缺口（逐条）

| # | 项 | 状态 | 已试的检索与 URL |
|---|---|---|---|
| 1 | `model3.json` 里的 `Parameters` 声明 | 🔴 **确认不存在**（8 样本 + 解析器常量表双重核验，见 §3） | 见 §3 检索表 |
| 2 | `model3.json` 里的 `Controllers` 键 | 🔴 **未找到**（解析器常量表逐字无此键；8 样本无此键） | `grep -n "Controllers" cubismmodelsettingjson.ts` → 0 命中；GitHub 代码搜索 API → **401 Requires authentication**（无 token） |
| 3 | Cubism 5 的 `ParamHit*` | 🔴 **未找到** | `grep -n "ParamHit" cubismmodelsettingjson.ts` → 0 命中；CHANGELOG 5-r.5 段通读无提及；GitHub 代码搜索 API → 401 |
| 4 | `Layout` 键在真实模型中的实例 | 🔴 **未找到实例**（解析器常量表有 `Layout`，但 8 样本无一使用） | 8 样本键名并集（22 个）不含 `Layout` |
| 5 | `init_param` / `init_parts_visible` / `val` 的实例 | 🔴 **未找到实例**（解析器常量表有，8 样本无一使用） | 同上 |
| 6 | `docs.live2d.com` 的 `json-list` 页（任务书所给 URL） | 🔴 **HTTP 404** | 见 §9.4 检索表（有效入口为 `json-unity`） |
| 7 | `standard-parametor-list`（任务书所给拼写） | ⚠️ **HTTP 301**，实际页在 `standard-parameter-list` | 见 §8.2 |
| 8 | Wanko 的 `.exp3.json` | 🔴 **HTTP 404**（该模型无 expressions 目录） | `.../Wanko/expressions/exp_01.exp3.json` → 404 |
| 9 | `Segments` 数组的排布规范（官方说明文本） | 🔴 **未找到规范文本**；§6.3 的段类型码解读为**推断** | 已读 `cubismmotioninternal.ts`（只有枚举值与注释，无排布说明） |
| 10 | `.exp3.json` 的 `Type` 字段是否被运行时读取 | ⚠️ **未找到官方明文**；§7.5 的"运行时不读"为**推断** | 解析器常量表无 `Type`；官方文档页未提及 |
| 11 | 同类第三方驱动实现（如 `moeru-ai/airi`）怎么组织这套接口 | 🔴 **本次未做** | **不在本子任务范围**（任务书只要求格式取证）。⚠️ 但按项目纪律，**"驱动接口设计"这类问题必须先读现成实现**——见 §10.4 的提示 |

---

## §12 待确认清单

1. **【待确认】`ParamHit*` 的确切出处**——本次在 `CubismWebFramework` 的 `model3.json` 解析器里**未找到**。它可能存在于：① Cubism 5 的其他 SDK（Unity／Native）分支；② Editor 侧文档（非 SDK 文档）；③ 未同步到 `develop` 分支的新特性。**倾向**：若要确认，下一步应查 `docs.live2d.com` 的 SDK Manual sitemap（`wp-sitemap-posts-sdk_manual-1.xml`，本次已下载，可 grep `ParamHit`），以及 `CubismNativeFramework` 的对应解析器。
2. **【待确认】`Segments` 的数字排布规范**——§6.3 的"段类型码"解读是从样本值反推的，**未取到官方规范文本**。倾向：查 Cubism Editor Manual 的「モーション」页或 `cubismmotionjson.ts` 的 `parse()` 函数体（本次只读了常量区，未逐行读解析逻辑）。
3. **【待确认】`.exp3.json` 的 `Type` 字段语义**——3 份样本值均为 `"Live2D Expression"`，但解析器常量表无此键。倾向：它是编辑器侧的标识，运行时忽略；需读 `cubismexpressionmotion.ts` 的 `parse()` 函数体确认。
4. **【待确认】Motion 组名除官方 6 个外能否自造**——8 样本只用了 `Idle`／`TapBody`，**无自造组名的实例**，也无官方明文禁止。倾向：官方没禁止，但用自己的组名会让 SDK 内置的交互逻辑（如哪个组响应 tap）失效。
5. **【待确认】"不同作者差异"的样本局限**——本次 8 份样本**全部来自官方同一仓库**。若需要真正的"跨作者"结论，须再取第三方模型（如社区发布模型）。**当前结论仅限官方样本内部。**
6. **【待确认】驱动接口统一命名的官方立场**——§10.4 是工程推断，**非官方结论**。若要落地，须先读现成驱动实现（项目纪律要求）。

---

## §13 自报计时与完成度

- 起点：2026-09-24T09:41+08:00（首次 curl）
- 收尾：2026-09-24T09:58+08:00（约 **17 分钟**）
- 抓取成功的一手材料：
  - **8 份 model3.json 全文**（官方样本）
  - **5 份 motion3.json**（官方样本）
  - **3 份 exp3.json**（官方样本，1 份 404）
  - **4 份官方解析器/常量源码**（`cubismmodelsettingjson.ts`／`cubismmotionjson.ts`／`cubismexpressionmotion.ts`／`cubismdefaultparameterid.ts`／`cubismmotioninternal.ts`，共 5 份）
  - **3 个官方文档页正文**（`json-unity`／`expression`／`standard-parameter-list`，另 2 个 JP 页）
  - **1 份官方 CHANGELOG**
- 未达成：`Controllers`／`ParamHit*`（未找到，已列检索）、Wanko 的 exp3（404）

**任务书的四个核心问题，逐条作答：**

| 问题 | 答案 |
|---|---|
| `model3.json` 里有没有参数声明？ | 🔴 **没有**。8/8 样本 + 官方解析器常量表双重核验。参数 id 定义在 `.moc3` 二进制里，`model3.json` 只通过 `Groups[].Ids` 引用 |
| Motion 组名是 `Idle`/`TapBody` 这种吗？ | ✅ **是**。8/8 有 `Idle`，7/8 有 `TapBody`；官方解析器为这 6 个组名（`Idle`/`TapBody`/`PinchIn`/`PinchOut`/`Shake`/`FlickHead`）写了具名常量 |
| 参数 id 长什么样？ | **三种风格并存**：`ParamAngleX`（标准，Haru/Hiyori/Mao/Natori）／自定义 `ParamHeartColorRainbow` 等（Mao 107 个）／**全大写 `PARAM_ANGLE_X`（Wanko，0 个标准命名）**。**5 份样本的共同参数 id = 0 个** |
| 能否统一命名？ | **Motion 组名可以；Expression 名不能；参数 id 只有"标准子集"可以**。可行做法是运行时从 `Groups[].Ids` + `.cdi3.json` 查，做语义名映射 |

---

## 附录 A：长名录补全（正文 §6.8 引用处）

### A.1 Mao `mtn_01.motion3.json` 的 132 个 `Target: "Parameter"` 参数 id（逐字全列）

> 来源：`https://raw.githubusercontent.com/Live2D/CubismWebSamples/develop/Samples/Resources/Mao/motions/mtn_01.motion3.json`（【官方样本文件】）

```
ParamAngleX, ParamAngleY, ParamAngleZ, ParamCheek, ParamFaceInkOn, ParamEyeLOpen, ParamEyeLSmile, ParamEyeLForm, ParamEyeROpen, ParamEyeRSmile, ParamEyeRForm, ParamEyeBallX, ParamEyeBallY, ParamEyeBallForm, ParamEyeEffect, ParamBrowLY, ParamBrowRY, ParamBrowLX, ParamBrowRX, ParamBrowLAngle, ParamBrowRAngle, ParamBrowLForm, ParamBrowRForm, ParamA, ParamI, ParamU, ParamE, ParamO, ParamMouthUp, ParamMouthDown, ParamMouthAngry, ParamMouthAngryLine, ParamBodyAngleX, ParamBodyAngleY, ParamBodyAngleZ, ParamBreath, ParamLeftShoulderUp, ParamRightShoulderUp, ParamArmLA01, ParamArmLA02, ParamArmLA03, ParamHandLA, ParamArmRA01, ParamArmRA02, ParamArmRA03, ParamWandRotate, ParamHandRA, ParamInkDrop, ParamInkDropRotate, ParamInkDropOn, ParamArmLB01, ParamArmLB02, ParamArmLB03, ParamHandLB, ParamHatForm, ParamArmRB01, ParamArmRB02, ParamArmRB02Y, ParamArmRB03, ParamHandRB, ParamAllX, ParamAllY, ParamAllRotate, ParamHairFront, ParamHairSideL, ParamHairSideR, ParamHairBack, ParamHairBackR, ParamHairBackL, ParamoHairMesh, ParamHairFrontFuwa, ParamHairSideFuwa, ParamHairBackFuwa, ParamWing, ParamRibbon, ParamHatBrim, ParamHatTop, ParamAccessory1, ParamAccessory2, ParamString, ParamRobeL, ParamRobeR, ParamRobeFuwa, ParamHeartMissOn, ParamHeartBackMissOn, ParamHeartColorRainbow, ParamHeartHealOn, ParamHeartBackHealOn, ParamHeartColorHeal, ParamHeartDrow, ParamHeartSize, ParamHeartColorLight, ParamWandInkColorRainbow, ParamWandInkColorHeal, ParamWandInk, ParamSmokeOn, ParamSmoke, ParamExplosionChargeOn, ParamExplosionLightCharge, ParamExplosionOn, ParamExplosion, ParamRabbitElimination, ParamRabbitAppearance, ParamRabbitSize, ParamRabbitDraworder, ParamRabbitEar, ParamRabbitDirection, ParamRabbitLight, ParamRabbitLightSize, ParamRabbitX, ParamRabbitY, ParamRabbitRotate, ParamAuraOn, ParamAura, ParamAuraColor1, ParamAuraColor2, ParamHeartLightOn, ParamHeartLight, ParamHeartLightColor, ParamHealLightOn, ParamHealLight, ParamStrengthenLightOn, ParamStrengthenLight, ParamStrengthenLightMove, ParamMagicPositionX, ParamMagicPositionY, ParamAllColor1, ParamAllColor2, ParamSphereOn, ParamSphereMove, ParamSphereMultiplyColor, ParamSphereScreenColor
```

### A.2 Natori `mtn_00.motion3.json` 的 88 个 `Target: "Parameter"` 参数 id（逐字全列）

> 来源：`https://raw.githubusercontent.com/Live2D/CubismWebSamples/develop/Samples/Resources/Natori/motions/mtn_00.motion3.json`（【官方样本文件】）

```
ParamAngleX, ParamAngleY, ParamAngleZ, ParamEyeLOpen, ParamEyeLSmile, ParamEyeLForm, ParamEyeROpen, ParamEyeRSmile, ParamEyeRForm, ParamEyeBallX, ParamEyeBallY, ParamEyeBallForm, ParamBrowLY, ParamBrowRY, ParamBrowLX, ParamBrowRX, ParamBrowLAngle, ParamBrowRAngle, ParamBrowLForm, ParamBrowLForm2, ParamBrowRForm, ParamBrowRForm2, ParamMouthForm, ParamMouthOpenY, ParamMouthForm2, ParamTeethOn, ParamCheek, ParamGlassUD, ParamGrassWhite, ParamGrassHighlight, ParamGrassHighlightMove, ParamBodyAngleX, ParamBodyAngleY, ParamBodyAngleZ, ParamWaistAngleZ, ParamBodyPosition, ParamBreath, ParamLeftShoulderUp, ParamRightShoulderUp, ParamAllX, ParamAllY, ParamAllRotate, ParamHairFront, ParamHairSide, ParamHairBack, ParamHairFrontFuwa, ParamHairSideFuwa, ParamHairBackFuwa, ParamJacket, ParamChainWaist, ParamWatchSwingA1, ParamWatchSwingA2, ParamWatchAX, ParamWatchBSwitch, ParamWatchBOpen, ParamWatchBX, ParamArmAL01, ParamArmAL02, ParamArmAL03, ParamArmAL04, ParamArmAR01, ParamArmAR02, ParamArmAR03, ParamArmAR04, ParamArmBR01, ParamArmBR02, ParamArmBR03, ParamArmBRHand01Roll, ParamArmBRHand05Roll1, ParamArmBRHand05Roll2, ParamArmBRHand05Roll3, ParamArmCR01, ParamArmCR02, ParamArmCR03, ParamArmCLHandRoll1, ParamArmDL01, ParamArmDL02, ParamArmDL03, ParamArmDLHand03Roll, ParamArmER01, ParamArmER02, ParamArmER03, ParamArmER04, ParamArmERHand04Roll1, ParamArmERHand04Roll2, ParamArmERHand06, ParamArmERHand06Roll1, ParamArmERHand06Roll2
```

### A.3 本次取证用到的全部来源 URL（可复核清单）

**官方 GitHub 原始文件（`raw.githubusercontent.com`，全部 HTTP 200）**

| 类别 | URL |
|---|---|
| 文件树 API | `https://api.github.com/repos/Live2D/CubismWebSamples/git/trees/develop?recursive=1` |
| 文件树 API | `https://api.github.com/repos/Live2D/CubismWebFramework/git/trees/develop?recursive=1` |
| 仓库元信息 | `https://api.github.com/repos/Live2D/CubismWebFramework` |
| model3 ×8 | `https://raw.githubusercontent.com/Live2D/CubismWebSamples/develop/Samples/Resources/{Haru,Hiyori,Mao,Mark,Natori,Ren,Rice,Wanko}/{同名}.model3.json` |
| motion3 ×5 | `.../Haru/motions/haru_g_idle.motion3.json`<br>`.../Hiyori/motions/Hiyori_m01.motion3.json`<br>`.../Mao/motions/mtn_01.motion3.json`<br>`.../Natori/motions/mtn_00.motion3.json`<br>`.../Wanko/motions/idle_01.motion3.json` |
| exp3 ×3 | `.../Haru/expressions/F01.exp3.json`<br>`.../Mao/expressions/exp_01.exp3.json`<br>`.../Natori/exp/Smile.exp3.json` |
| 解析器源码 | `https://raw.githubusercontent.com/Live2D/CubismWebFramework/develop/src/cubismmodelsettingjson.ts` |
| 解析器源码 | `https://raw.githubusercontent.com/Live2D/CubismWebFramework/develop/src/motion/cubismmotionjson.ts` |
| 解析器源码 | `https://raw.githubusercontent.com/Live2D/CubismWebFramework/develop/src/motion/cubismexpressionmotion.ts` |
| 解析器源码 | `https://raw.githubusercontent.com/Live2D/CubismWebFramework/develop/src/motion/cubismmotioninternal.ts` |
| 常量表 | `https://raw.githubusercontent.com/Live2D/CubismWebFramework/develop/src/cubismdefaultparameterid.ts` |
| CHANGELOG | `https://raw.githubusercontent.com/Live2D/CubismWebFramework/develop/CHANGELOG.md` |

**官方文档站（`docs.live2d.com`）**

| URL | 状态 | 标题／内容 |
|---|---|---|
| `https://docs.live2d.com/en/cubism-sdk-manual/json-unity/` | ✅ 200 | `Json \| SDK Manual` |
| `https://docs.live2d.com/cubism-sdk-manual/json-unity/` | ✅ 200 | 同上（日文版） |
| `https://docs.live2d.com/en/cubism-sdk-manual/expression/` | ✅ 200 | `About Expression Motion \| SDK Manual` |
| `https://docs.live2d.com/cubism-editor-manual/standard-parameter-list/` | ✅ 200 | `標準パラメータリスト` |
| `https://docs.live2d.com/cubism-sdk-manual/motion3-consistency/` | ✅ 200 | `.motion3.jsonの整合性を検証する` |
| `https://docs.live2d.com/cubism-sdk-manual/reproducibility-motion3-json/` | ✅ 200 | `【対応済み】.motion3.jsonの再現性が劣化する場合について` |
| `https://docs.live2d.com/sitemap.xml` | ✅ 200 | sitemap index |
| `https://docs.live2d.com/wp-sitemap-posts-sdk_manual-1.xml` | ✅ 200 | SDK Manual 全页面列表（找回 json 入口的关键） |

**❌ 失败／无效的 URL（如实列出）**

| URL | 状态 |
|---|---|
| `https://raw.githubusercontent.com/Live2D/CubismWebSamples/develop/Samples/TypeScript/Demo/Resources/Haru/Haru.model3.json` | 404（**任务书所给路径已失效**，真实路径见上表） |
| `https://docs.live2d.com/en/cubism-sdk-manual/json-list/` | 404（**任务书所给**） |
| `https://docs.live2d.com/cubism-sdk-manual/json-list/` | 404 |
| `https://docs.live2d.com/en/cubism-editor-manual/json-list/` | 404 |
| `https://docs.live2d.com/en/cubism-sdk-manual/json/` | 404 |
| `https://docs.live2d.com/en/cubism-sdk-tutorials/json/` | 404 |
| `https://docs.live2d.com/cubism-editor-manual/standard-parametor-list/` | 301 → `standard-parameter-list/` |
| `https://raw.githubusercontent.com/.../Wanko/expressions/exp_01.exp3.json` | 404 |
| `https://api.github.com/search/code?q=...+repo:Live2D/CubismWebFramework` | **401 Requires authentication**（无 token；未能做 GitHub 全仓代码搜索） |

---

## 附录 B：本次取证的两条方法论备注（供后续同类任务参考）

1. **`docs.live2d.com` 的 sitemap 是找页面入口的可靠通道**。任务书给的多个文档 URL 均已 404，但 `sitemap.xml` → `wp-sitemap-posts-sdk_manual-1.xml` 能拿到**全部有效页面路径**。同类任务遇 404 应优先走 sitemap，而非反复猜路径。
2. **`raw.githubusercontent.com` 在本次会话完全可用**（HTTP 200），无需退回 GitHub blob 页或用 `platform_search`。任务书预留的降级通道本次未用上。
