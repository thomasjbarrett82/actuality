// Routes. The app's screens are navigation state in the `app` store (06 §3), all under `/`; the router
// adds only the development gallery. Hash history: the page is loaded from a file.
import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router';
import MainScreen from './screens/shell/MainScreen.vue';

const routes: RouteRecordRaw[] = [{ path: '/', name: 'main', component: MainScreen }];

if (import.meta.env.DEV) {
  routes.push({
    path: '/dev/gallery',
    name: 'gallery',
    component: () => import('./screens/dev/GalleryScreen.vue'),
  });
}

routes.push({ path: '/:rest(.*)*', redirect: '/' });

export const router = createRouter({ history: createWebHashHistory(), routes });
