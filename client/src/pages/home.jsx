import GalleryPage from '../components/GalleryPage.jsx';
import { mountPage } from '../components/Shell.jsx';

mountPage(GalleryPage, { active: new URLSearchParams(window.location.search).get('tab') || 'featured' });
