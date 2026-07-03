import { createRouter, createWebHistory } from 'vue-router';
import DashboardView from '../components/dashboard/DashboardView.vue';
import IslandView from '../components/island/IslandView.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: DashboardView },
    { path: '/widget', component: IslandView },
  ],
});

export default router;
