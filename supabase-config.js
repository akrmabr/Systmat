// Public runtime configuration for the new Supabase project.
// This file may be published with the frontend.
// Never place SUPABASE_SERVICE_ROLE_KEY here.
window.__UNIVERSAL_RETAIL_SUPABASE__ = {
  url: 'https://ujnezwjindypyvawmpry.supabase.co',
  anonKey: 'sb_publishable_W8B9nYkcN3pGils8-k2DRw_-5hdk9de'
};

window.__UNIVERSAL_RETAIL_BUSINESS_TYPES__ = {
  clothing: 'محل ملابس', shoes: 'محل أحذية', homeware: 'محل أواني منزلية',
  cosmetics: 'مستحضرات تجميل', grocery: 'بقالة / مواد غذائية', supermarket: 'سوبر ماركت',
  building_materials: 'مواد بناء', electrical: 'أجهزة كهربائية', electronics: 'محل إلكترونيات',
  mobile: 'هواتف وإكسسوارات', furniture: 'محل أثاث', home_furnishings: 'مفروشات منزلية',
  hardware: 'العدد والأدوات', stationery: 'مكتبة وقرطاسية', perfume: 'محل عطور',
  pharmacy: 'صيدلية / مستلزمات طبية', spare_parts: 'قطع غيار', car_accessories: 'إكسسوارات سيارات',
  general: 'تجارة عامة', other: 'نشاط آخر'
};

// License verification uses the same new Supabase project.
window.__UNIVERSAL_RETAIL_LICENSE__ = {
  url: window.__UNIVERSAL_RETAIL_SUPABASE__.url,
  anonKey: window.__UNIVERSAL_RETAIL_SUPABASE__.anonKey
};
