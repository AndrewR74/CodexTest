import { FeaturedSession } from './FeaturedSession.js';

const ObserveSubject = {
  REGISTRATION_TYPE: 'REGISTRATION_TYPE',
  ADMISSION_ITEM: 'ADMISSION_ITEM'
};

const debounce = (func, wait) => {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
};

export default class extends HTMLElement {
  images = [
    'https://d3auq6qtr2422x.cloudfront.net/images/bill-hamway-2pW3U_0rT1U-unsplash.jpeg',
    'https://d3auq6qtr2422x.cloudfront.net/images/christian-holzinger-ROJi8Uo4MpA-unsplash.jpeg',
    'https://d3auq6qtr2422x.cloudfront.net/images/chuttersnap-Q_KdjKxntH8-unsplash.jpeg'
  ];

  unsubCallbacks = [];

  constructor({ configuration, theme }) {
    super();
    // store theme and configuration for later use
    this.configuration = configuration;
    this.theme = theme;

    // Create a shadow root
    this.attachShadow({ mode: 'open' });

    // attempting to define this custom element a second time (e.g. having two copies of this widget)
    // will cause an error
    if (!customElements.get('featured-session-registration')) {
      // define a custom element that we will use to display each featured session
      customElements.define('featured-session-registration', FeaturedSession);
    }
  }

  // create a featured session card for each featured session using our accessory custom element and session detail information
  createFeaturedSessionCards(featuredSessionIds, sessions, regTypes, featuredSessionContainer, feesBySessionId) {
    featuredSessionIds.forEach(featuredSessionId => {
      const featuredSession = sessions.find(session => session.id === featuredSessionId);
      featuredSession.associatedRegistrationTypes = featuredSession.associatedRegistrationTypes.map(id => regTypes[id]);

      if (featuredSession) {
        featuredSessionContainer.appendChild(
          new FeaturedSession(
            featuredSession,
            this.cventSdk,
            this.theme,
            this.configuration,
            this.images.pop(),
            feesBySessionId
          )
        );
      }
    });
  }

  async connectedCallback() {
    // container for the featured session cards
    const featuredSessionContainer = document.createElement('div');
    featuredSessionContainer.style.display = 'flex';
    featuredSessionContainer.style.width = '100%';

    // placeholder so that our element doesn't render without height in the editor before we've added sessions
    const placeholderDiv = document.createElement('div');
    placeholderDiv.style.height = '200px';
    placeholderDiv.style.width = '0px';
    featuredSessionContainer.appendChild(placeholderDiv);

    // get our array of featured session ids
    const featuredSessionIds = this.configuration?.featuredSessionIds ?? [];

    // create our session generator
    const sessionGenerator = await this.getSessionGenerator('dateTimeDesc', 20);
    const sessions = [];

    // iterate over the generator until we have retrieved SessionDetail objects for all of our featured sessions
    for await (const page of sessionGenerator) {
      // for each session in our current page
      page.sessions.forEach(session => {
        // if that session is one of our featured sessions...
        if (featuredSessionIds.find(featuredSessionId => session.id === featuredSessionId)) {
          sessions.push(session);
        }
      });

      // if we have found all of our sessions, stop fetching pages
      if (featuredSessionIds.length === sessions.length) {
        break;
      }
    }

    const feesBySessionId = {};
    if (this.configuration?.showFees && this.cventSdk.getApplicableProductFeesGenerator) {
      // only query fees related to the featured sessions
      const filter = `productId in (${featuredSessionIds.map(id => `'${id}'`).join(',')})`;
      const feesGenerator = await this.cventSdk.getApplicableProductFeesGenerator({ filter });
      for await (const page of feesGenerator) {
        for (const fee of page.records) {
          feesBySessionId[fee.productId] = fee;
        }
      }
    }

    const associatedRegistrationTypes = sessions.reduce(
      (regTypeIds, session) => [...regTypeIds, ...(session?.associatedRegistrationTypes || [])],
      []
    );
    const regTypes = await this.cventSdk.getRegistrationTypes(associatedRegistrationTypes);

    this.createFeaturedSessionCards(featuredSessionIds, sessions, regTypes, featuredSessionContainer, feesBySessionId);

    /**
     * Clears the featured session container and creates new session cards.
     *
     * Uses debounce to avoid multiple callback triggers for observed subjects.
     * For example, observing both REGISTRATION_TYPE and ADMISSION_ITEM subject updates
     * could cause a registration type update to trigger an admission item update internally,
     * resulting in multiple calls to the observe callback functions.
     */
    const clearAndCreateSessionCards = debounce(() => {
      featuredSessionContainer.replaceChildren();
      this.createFeaturedSessionCards(
        featuredSessionIds,
        sessions,
        regTypes,
        featuredSessionContainer,
        feesBySessionId
      );
    }, 300);

    // observes changes to admission item and re-create session cards
    const admitItemObserve = this.cventSdk.observe(ObserveSubject.ADMISSION_ITEM, clearAndCreateSessionCards);
    // Store the ADMISSION_ITEM unobserve callback to unsubscribe later
    this.unsubCallbacks.push(admitItemObserve.unobserve);

    // observes changes to registration type and re-create session cards
    const regTypeObserve = this.cventSdk.observe(ObserveSubject.REGISTRATION_TYPE, clearAndCreateSessionCards);
    // Store the REGISTRATION_TYPE unobserve callback to unsubscribe later
    this.unsubCallbacks.push(regTypeObserve.unobserve);

    this.shadowRoot.appendChild(featuredSessionContainer);
  }

  disconnectedCallback() {
    this.unsubCallbacks.forEach(unsub => unsub());
    this.unsubCallbacks = [];
  }
}
