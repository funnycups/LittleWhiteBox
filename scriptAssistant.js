import { extension_settings, getContext } from "../../../extensions.js";
import { saveSettingsDebounced } from "../../../../script.js";
import { setExtensionPrompt, extension_prompt_types } from "../../../../script.js";
import { eventSource, event_types } from "../../../../script.js";

const EXT_ID = "LittleWhiteBox";
const SCRIPT_MODULE_NAME = "xiaobaix-script";
const extensionFolderPath = `scripts/extensions/third-party/${EXT_ID}`;

function initScriptAssistant() {
    if (!extension_settings[EXT_ID].scriptAssistant) {
        extension_settings[EXT_ID].scriptAssistant = { enabled: false };
    }
    
    $('#xiaobaix_script_assistant').on('change', function() {
        const globalEnabled = window.isXiaobaixEnabled !== undefined ? window.isXiaobaixEnabled : true;
        if (!globalEnabled) return; 

        const enabled = $(this).prop('checked');
        extension_settings[EXT_ID].scriptAssistant.enabled = enabled;
        saveSettingsDebounced();

        if (enabled) {
            injectScriptDocs();
        } else {
            removeScriptDocs();
        }
    });
    
    $('#xiaobaix_script_assistant').prop('checked', extension_settings[EXT_ID].scriptAssistant.enabled);
    
    setupEventListeners();
    
    if (extension_settings[EXT_ID].scriptAssistant.enabled) {
        setTimeout(() => injectScriptDocs(), 1000);
    }
}

function setupEventListeners() {
    eventSource.on(event_types.CHAT_CHANGED, () => {
        setTimeout(() => checkAndInjectDocs(), 500);
    });
    
    eventSource.on(event_types.MESSAGE_RECEIVED, () => {
        checkAndInjectDocs();
    });
    
    eventSource.on(event_types.USER_MESSAGE_RENDERED, () => {
        checkAndInjectDocs();
    });
    
    eventSource.on(event_types.SETTINGS_LOADED_AFTER, () => {
        setTimeout(() => checkAndInjectDocs(), 1000);
    });
    
    eventSource.on(event_types.APP_READY, () => {
        setTimeout(() => checkAndInjectDocs(), 1500);
    });
}

function checkAndInjectDocs() {
    const globalEnabled = window.isXiaobaixEnabled !== undefined ? window.isXiaobaixEnabled : extension_settings[EXT_ID].enabled;
    if (globalEnabled && extension_settings[EXT_ID].scriptAssistant?.enabled) {
        injectScriptDocs();
    } else {
        removeScriptDocs();
    }
}

async function injectScriptDocs() {
    try {
        let docsContent = '';
        
        try {
            const response = await fetch(`${extensionFolderPath}/scriptDocs.md`);
            if (response.ok) {
                docsContent = await response.text();
            }
        } catch (error) {
            docsContent = "无法加载scriptDocs.md文件";
        }
        
        const formattedPrompt = `
【小白X插件 - 写卡助手】
你是小白X插件的内置助手，专门帮助用户创建STscript脚本和交互式界面的角色卡。
关于小白X插件核心功能:
1. 代码块渲染功能:
   - SillyTavern原生只支持显示静态代码块，无法执行JavaScript或渲染HTML
   - 小白X将聊天中包含HTML标签(完整的<html>, <!DOCTYPE>或单独的<script>)的代码块自动转换为交互式iframe
   - 小白X提供了特殊的桥接API: STscript()函数
     • 这是一个异步函数，接受斜杠命令字符串作为参数
     • 函数会将命令发送给SillyTavern执行，并返回执行结果
     • 使用await关键字等待命令执行完成并获取结果
     • 这使iframe内的JavaScript代码能与SillyTavern通信并执行各种SillyTavern的斜杠命令，不要尝试通过window.parent直接访问SillyTavern的函数，这样不会工作
 
   正确用法示例:
   \`\`\`html
   <!DOCTYPE html>
   <html>
   <head>
       <title>交互式界面</title>
       <style>
           body { font-family: Arial; padding: 10px; }
           button { margin: 5px; }
       </style>
   </head>
   <body>
       <h3>天气查询</h3>
       <button onclick="checkWeather()">查询天气</button>
       <div id="display"></div>
       
       <script>
       async function checkWeather() {
           // 调用STscript函数执行斜杠命令
           await STscript('/echo 正在查询天气...');
       
           // 获取变量值
           const 天气 = await STscript('/getvar 天气');
       
           // 在界面中显示结果
           document.getElementById('display').innerHTML = 天气 || '晴天';
       }
       </script>
   </body>
   </html>
   \`\`\`
2. 定时任务模块:
   - 拓展菜单中允许设置"在对话中自动执行"的斜杠命令
   - 可以设置触发频率(每几楼层)、触发条件(AI消息后/用户消息前/每轮对话)
   - 每个任务包含:名称、要执行的命令、触发间隔、触发类型
   - 注册了/xbqte命令手动触发任务: \`/xbqte 任务名称\`
   - 注册了/xbset命令调整任务间隔: \`/xbset 任务名称 间隔数字\`
   - 任务命令可以使用所有标准STscript斜杠命令
3. 与SillyTavern正则表达式功能的配合:
   - SillyTavern提供了原生的正则设置功能，用于自动转换AI的消息输出
   - 当设计包含交互界面的角色卡时，你应该教导用户如何使用这一功能
   - 正确的工作流是:
     a) 在AI输出中包含特定标记(如\`[状态面板]\`)
     b) 在角色卡设置的格式化功能中添加正则表达式来替换这些标记为HTML代码
     c) 勾选小白X的代码块渲染功能显示交互式界面
   
   正则表达式示例:
   - 格式: \`/\\[状态面板\\]/g\` (匹配文本)
   - 替换为: \`\`\`html
<div id="status">
  <h3>角色状态</h3>
  <p>HP: <span id="hp">100</span>/100</p>
  <script>
    // 脚本代码
  </script>
</div>
\`\`\`
   这样设置后，每当AI输出包含[状态面板]时，SillyTavern会自动将其替换为HTML代码块，
   然后小白X会将其渲染为可交互的界面。
${docsContent}
`;
        
        setExtensionPrompt(
            SCRIPT_MODULE_NAME, 
            formattedPrompt, 
            extension_prompt_types.IN_PROMPT, 
            2,
            false, 
            0
        );
    } catch (error) {}
}

function removeScriptDocs() {
    setExtensionPrompt(SCRIPT_MODULE_NAME, '', extension_prompt_types.IN_PROMPT);
}

window.injectScriptDocs = injectScriptDocs;
window.removeScriptDocs = removeScriptDocs;

export { initScriptAssistant };