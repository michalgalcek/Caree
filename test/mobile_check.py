import subprocess, time, json
from playwright.sync_api import sync_playwright
env={'PORT':'8095','PATH':'/usr/bin:/usr/local/bin','DATA_DIR':'/tmp/garagee-test','NODE_ENV':'test'}
subprocess.run(['mkdir','-p','/tmp/garagee-test'])
srv = subprocess.Popen(['node','--no-warnings','src/server.js'], cwd='/home/claude/caree-repo', env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
time.sleep(2.5); problems=[]
html = subprocess.check_output(['node','--input-type=module','-e',"const m=await import('/home/claude/caree-repo/src/web/widget.js');process.stdout.write(m.WIDGET_HTML)"]).decode()
with sync_playwright() as pw:
    b=pw.chromium.launch(executable_path='/usr/bin/google-chrome')
    for name in ['iPhone SE','iPhone 13','Pixel 7','Galaxy S9+']:
        ctx=b.new_context(**pw.devices[name])
        for path in ['/','/signup','/plans','/privacy','/support']:
            p=ctx.new_page(); errs=[]; p.on('pageerror',lambda e:errs.append(str(e)))
            r=p.goto('http://localhost:8095'+path); p.wait_for_timeout(300)
            o=p.evaluate('document.documentElement.scrollWidth-window.innerWidth')
            if o>1: problems.append(f'{name} {path}: overflow {o}px')
            if errs: problems.append(f'{name} {path} JS {errs}')
            if name=='iPhone 13' and path=='/': p.screenshot(path='/home/claude/garagee-mobil.png')
            p.close()
        w=ctx.new_page(); w.set_content(html); w.wait_for_timeout(300)
        o=w.evaluate('document.documentElement.scrollWidth-window.innerWidth')
        if o>1: problems.append(f'{name} widget overflow {o}px')
        if name=='iPhone 13': w.wait_for_timeout(200); w.screenshot(path='/home/claude/garagee-widget.png')
        ctx.close()
    b.close()
srv.kill(); print('\n'.join(problems) if problems else 'MOBILE OK')
