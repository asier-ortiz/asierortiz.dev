export interface SocialLinkProps {
  platform:
    | 'github'
    | 'twitter'
    | 'mastodon'
    | 'linkedin'
    | 'instagram'
    | 'threads'
    | 'facebook'
    | 'youtube'
    | 'twitch'
    | 'tiktok'
    | 'snapchat'
    | 'reddit'
    | 'pinterest'
    | 'medium'
    | 'dev'
    | 'dribbble'
    | 'behance'
    | 'codepen'
    | 'producthunt'
    | 'discord'
    | 'slack'
    | 'whatsapp'
    | 'telegram'
    | 'email'
    | 'kaggle'
    | 'rss';
  link: string;
}

export interface SiteDataProps {
  name: string;
  title: string;
  description: string;
  useAnimations?: boolean;
  socialLinks: SocialLinkProps[];
  author: {
    name: string;
    email: string;
  };
  defaultImage: {
    src: string;
    alt: string;
  };
  rss: {
    title: string;
    description: string;
  };
  newsletter: {
    url: string;
    label?: string;
  };
  language: string;
}

const siteData: SiteDataProps = {
  name: 'Asier Ortiz',
  title: 'Asier Ortiz - Full-Stack & Data Developer',
  description: 'Asier Ortiz portfolio & blog',
  useAnimations: true,

  socialLinks: [
    {
      platform: 'github',
      link: 'https://github.com/asier-ortiz',
    },
    {
      platform: 'kaggle',
      link: 'https://www.kaggle.com/asierortiz',
    },
    {
      platform: 'linkedin',
      link: 'https://www.linkedin.com/in/asier-ortiz',
    },
    {
      platform: 'email',
      link: 'mailto:hello@asierortiz.com',
    },
    {
      platform: 'rss',
      link: '/rss.xml',
    },
  ],

  author: {
    name: 'Asier Ortiz',
    email: 'hello@asierortiz.com',
  },

  defaultImage: {
    src: '/images/default-og-image.png', // Default Image for social networks
    alt: 'Default social image for Asier Ortiz portfolio & blog.',
  },

  rss: {
    title: 'Asier Ortiz - Blog',
    description: 'Latest posts about AI, Machine Learning and Web Development',
  },

  newsletter: {
    url: 'https://buttondown.com/asierortiz',
    label: 'Subscribe to Asier Ortiz’s newsletter',
  },

  language: 'en-us',
};

export default siteData;
