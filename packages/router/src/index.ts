import { interfaces } from '@garfish/core';
import { createKey } from '@garfish/utils';
import router, {
  initRedirect,
  RouterInterface,
  listenRouterAndReDirect,
} from './context';

declare module '@garfish/core' {
  export default interface Garfish {
    router: RouterInterface;
    apps: Record<string, interfaces.App>;
  }

  export namespace interfaces {
    export interface Config {
      autoRefreshApp?: boolean;
      onNotMatchRouter?: (path: string) => Promise<void> | void;
    }

    export interface AppInfo {
      activeWhen?: string | ((path: string) => boolean); // 手动加载，可不填写路由
      active?: (appInfo: AppInfo, rootPath: string) => void;
      deactive?: (appInfo: AppInfo, rootPath: string) => void;
      rootPath?: string;
      basename?: string;
    }
  }
}

export { RouterInterface } from './context';

interface Options {
  autoRefreshApp?: boolean;
  onNotMatchRouter?: (path: string) => Promise<void> | void;
}

export function GarfishRouter(_args?: Options) {
  return function (Garfish: interfaces.Garfish): interfaces.Plugin {
    Garfish.apps = {};
    Garfish.router = router;

    return {
      name: 'router',
      version: __VERSION__,

      bootstrap(options: interfaces.Options) {
        let activeApp = null;
        const unmounts: Record<string, Function> = {};
        const { basename } = options;
        const { autoRefreshApp = true, onNotMatchRouter = () => null } =
          Garfish.options;

        async function active(appInfo: interfaces.AppInfo, rootPath: string) {
          const { name, cache = true, active } = appInfo;
          if (active) return active(appInfo, rootPath);
          appInfo.rootPath = rootPath;

          const currentApp = (activeApp = createKey());
          const app = await Garfish.loadApp(appInfo.name, {
            basename: rootPath,
            entry: appInfo.entry,
            cache: true,
            domGetter: appInfo.domGetter,
          });
          app.appInfo.basename = rootPath;

          const call = async (app: interfaces.App, isRender: boolean) => {
            if (!app) return;
            const isDes = cache && app.mounted;
            if (isRender) {
              return await app[isDes ? 'show' : 'mount']();
            } else {
              return app[isDes ? 'hide' : 'unmount']();
            }
          };

          Garfish.apps[name] = app;
          unmounts[name] = () => call(app, false);

          if (currentApp === activeApp) {
            await call(app, true);
          }
        }

        async function deactive(appInfo: interfaces.AppInfo, rootPath: string) {
          activeApp = null;
          const { name, deactive } = appInfo;
          if (deactive) return deactive(appInfo, rootPath);

          const unmount = unmounts[name];
          unmount && unmount();
          delete Garfish.apps[name];

          // Nested scene to remove the current application of nested data
          // To avoid the main application prior to application
          const needToDeleteApps = router.routerConfig.apps.filter((app) => {
            if (appInfo.rootPath === app.basename) return true;
          });
          if (needToDeleteApps.length > 0) {
            needToDeleteApps.forEach((app) => {
              delete Garfish.appInfos[app.name];
              delete Garfish.cacheApps[app.name];
            });
            router.setRouterConfig({
              apps: router.routerConfig.apps.filter((app) => {
                return !needToDeleteApps.some(
                  (needDelete) => app.name === needDelete.name,
                );
              }),
            });
          }
        }

        const apps = Object.values(Garfish.appInfos);

        const appList = apps.filter((app) => {
          if (!app.basename) app.basename = basename;
          return !!app.activeWhen;
        }) as Array<Required<interfaces.AppInfo>>;

        const listenOptions = {
          basename,
          active,
          deactive,
          autoRefreshApp,
          notMatch: onNotMatchRouter,
          apps: appList,
        };
        listenRouterAndReDirect(listenOptions);
      },

      registerApp(appInfos) {
        const appList = Object.values(appInfos);
        // @ts-ignore
        router.registerRouter(appList.filter((app) => !!app.activeWhen));
        // After completion of the registration application, trigger application mount
        // Has been running after adding routing to trigger the redirection
        if (!Garfish.running) return;
        initRedirect();
      },
    };
  };
}
