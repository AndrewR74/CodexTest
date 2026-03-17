export class FeaturedSession extends HTMLElement {
  constructor(session, cventSdk, theme, config, imageURL, feesBySessionId) {
    super();

    if (!session) {
      return;
    }

    this.session = session;
    this.theme = theme;
    this.config = config;
    this.imageURL = imageURL;
    this.feesBySessionId = feesBySessionId;
    this.cventSdk = cventSdk;

    this.attachShadow({ mode: 'open' });
  }

  async connectedCallback() {
    const { description, location, startDateTime, endDateTime, category } = this.session;

    this.style.width = '32%';
    this.style.margin = '0px 8px 0px 8px';
    this.style.borderRadius = '8px';
    this.style.overflow = 'hidden';

    const sessionInfoBlock = document.createElement('div');

    // use a value from the widget configuration to override the site-wide theme
    sessionInfoBlock.style.backgroundColor = this.config?.customColors?.background ?? this.theme.palette.secondary;
    sessionInfoBlock.style.height = '100%';
    sessionInfoBlock.style.display = 'flex';
    sessionInfoBlock.style.flexDirection = 'column';
    sessionInfoBlock.style.minWidth = '100%';

    // image
    const image = document.createElement('img');
    image.src = this.imageURL;
    image.style.width = '100%';
    image.style.height = '184px';
    image.style.objectFit = 'cover';

    // session title
    const title = this.getTitleContainer();

    // session location
    const locationEle = document.createElement('h2');
    locationEle.textContent = location?.name ?? '';
    setStylesOnElement(
      { ...this.theme.header2, margin: 0, padding: '0px 10px 10px 10px', fontSize: '.75rem', display: 'inline' },
      locationEle
    );

    // description text
    const sessionDescription = document.createElement('p');
    sessionDescription.innerHTML = description;
    setStylesOnElement(
      { ...this.theme.mainText, margin: 0, padding: '10px', fontSize: '.75rem', flexGrow: '1' },
      sessionDescription
    );

    // Session Category
    const sessionCategory = document.createElement('div');
    setStylesOnElement(
      {
        backgroundColor: this.theme.palette.accent,
        padding: '2px 4px 2px 4px',
        fontSize: '.75rem',
        display: 'block'
      },
      sessionCategory
    );

    const sessionCategoryName = document.createElement('p');
    sessionCategoryName.textContent = category.name;
    setStylesOnElement(
      {
        ...this.theme.paragraph,
        margin: '0px',
        display: 'inline'
      },
      sessionCategoryName
    );

    const sessionCategoryDescription = document.createElement('div');
    sessionCategoryDescription.innerHTML = category.description;
    setStylesOnElement(
      {
        ...this.theme.altParagraph,
        margin: '0px',
        display: 'none',
        fontSize: '.75rem'
      },
      sessionCategoryDescription
    );

    // Display the session category description on mouseover
    sessionCategory.onmouseenter = () => {
      if (category.description) {
        sessionCategoryDescription.style.display = 'block';
        sessionCategoryDescription.style.margin = '5px';
      }
    };

    sessionCategory.onmouseleave = () => {
      sessionCategoryDescription.style.display = 'none';
      sessionCategoryDescription.style.margin = '0px';
    };

    sessionCategory.append(sessionCategoryName, sessionCategoryDescription);

    // date range text
    const timeRange = document.createElement('h2');
    const start = new Date(startDateTime);
    const end = new Date(endDateTime);
    const options = { dateStyle: 'medium', timeStyle: 'short' };

    timeRange.textContent = `${start.toLocaleString('en-US', options)} - ${end.toLocaleString('en-US', options)}`;

    // create buttons for registration

    const regActionElement = await this.buildRegActionElement();

    setStylesOnElement(
      {
        ...this.theme.header3,
        margin: '0px',
        padding: '10px 10px 0px 10px',
        fontSize: '.75rem'
      },
      timeRange
    );

    // append all children to the div
    sessionInfoBlock.append(
      image,
      timeRange,
      locationEle,
      title,
      sessionCategory,
      sessionDescription,
      regActionElement
    );
    this.shadowRoot.append(sessionInfoBlock);
  }

  getTitleContainer = () => {
    const titleContainer = document.createElement('div');
    const title = document.createElement('h1');

    setStylesOnElement({ ...this.theme.header1, margin: 0, padding: '0px 10px 0px 10px', fontSize: '1.5rem' }, title);
    titleContainer.append(title);

    // return if fee not configured
    if (!this.config?.showFees) {
      title.textContent = this.session.name;
      return titleContainer;
    }
    const fee = this.feesBySessionId[this.session.id];

    if (!fee) {
      title.textContent = `${this.session.name} - Free`;
      return titleContainer;
    }

    const chargePolicies = getApplicableChargePolicies(fee);
    title.textContent = `${this.session.name} - $${chargePolicies[0].amount}`;

    // early bird pricing
    if (chargePolicies.length > 1) {
      const deadline = document.createElement('h2');
      const earlyBirdUntil = new Date(chargePolicies[0].effectiveUntil);
      // assume event timezone is UTC
      const earlyBirdUntilUTC = new Date(earlyBirdUntil.getTime() + earlyBirdUntil.getTimezoneOffset() * 60 * 1000);

      deadline.textContent = `Changes to $${chargePolicies[1].amount} after ${earlyBirdUntilUTC.toLocaleDateString(
        'en-US',
        { dateStyle: 'medium' }
      )}`;

      setStylesOnElement(
        {
          ...this.theme.header2,
          margin: '0',
          padding: '10px 10px 0px 10px',
          fontSize: '.75rem'
        },
        deadline
      );

      titleContainer.append(deadline);
    }
    return titleContainer;
  };

  // Generate text describing the registration status and possible registration action for this session
  async getRegActionText(session) {
    const { id: sessionId, capacity, waitlistCapacity } = session;
    const { status, subStatus } = await this.cventSdk.getSessionStatus(sessionId);
    // text describing the action that can be taken for this session
    let regAction;
    // text describing the current status of this session
    let regStatus;

    switch (status) {
      case SessionStatus.OPEN: {
        // capacity values of -1 indicate unlimited capacity
        regStatus =
          capacity.inPerson.available === -1
            ? 'This session is available.'
            : `This session is available. ${capacity.inPerson.available ?? capacity.virtual.available}/${
                capacity.inPerson.total ?? capacity.virtual.total
              } spots remaining`;
        regAction = 'Register';
        break;
      }
      case SessionStatus.OPEN_FROM_WAITLIST: {
        regStatus =
          capacity.inPerson.available === -1
            ? `Spots are newly available for this session, would you like to leave the waitlist and register?`
            : `This session now has ${
                capacity.inPerson.available ?? capacity.virtual.available
              } spot(s) available, would you like to leave the waitlist and register?`;
        regAction = 'Register';
        break;
      }
      case SessionStatus.WAITLISTED: {
        regStatus = 'You are on the waitlist for this session.';
        regAction = 'Leave Waitlist';
        break;
      }
      case SessionStatus.SELECTED: {
        regStatus = 'You are registered for this session.';
        regAction = 'Remove';
        break;
      }
      case SessionStatus.WAITLIST_AVAILABLE: {
        regStatus =
          waitlistCapacity.inPerson.available === -1
            ? 'This session is full, but you may join the in-person waitlist.'
            : `This session is full, but you may join the in-person waitlist.\n ${waitlistCapacity.inPerson.available}/${waitlistCapacity.inPerson.total} spots remaining`;
        regAction = 'Join the Waitlist';
        break;
      }
      case SessionStatus.INCLUDED: {
        if (subStatus === IncludedSubStatus.INCLUDED_BY_SESSION) {
          regStatus = 'This session is included automatically.';
        }
        if (subStatus === IncludedSubStatus.INCLUDED_BY_ADMISSION_ITEM) {
          regStatus = 'This session is included with your admission item selection.';
        }
        break;
      }
      case SessionStatus.BUNDLED: {
        regStatus = 'This session is included as part of your bundle selection';
        break;
      }
      case SessionStatus.WAITLIST_UNAVAILABLE: {
        if (subStatus === WaitlistSubStatus.NO_WAITLIST) {
          regStatus = 'This session is full';
        }
        if (subStatus === WaitlistSubStatus.WAITLIST_FULL) {
          regStatus = 'The waitlist for this session is full';
        }
        break;
      }
      case SessionStatus.CLOSED: {
        regStatus = 'This session is not open for registration';
        break;
      }
      case SessionStatus.NOT_AVAILABLE: {
        regStatus = 'This session is not available for your chosen registration type and/or admission item';
        break;
      }
      // SESSION_DNE, REGISTRATION_DNE
      default:
        regStatus = null;
        break;
    }
    return { regAction, regStatus };
  }

  // create an element that contains text indicating the status of the session and, if the session is in an
  // actionable status, a button that will register/waitlist/unregister/dewaitlist the registrant for the session
  async buildRegActionElement() {
    const { id: sessionId } = this.session;

    const { regAction, regStatus } = await this.getRegActionText(this.session);

    const regActionContainer = document.createElement('div');
    regActionContainer.style.padding = '10px';
    regActionContainer.style.display = 'flex';
    regActionContainer.style.justifyContent = 'center';
    regActionContainer.style.flexDirection = 'column';

    const registrationStatusText = document.createElement('p');
    setStylesOnElement({ ...this.theme.header4, overflow: 'break-word', fontSize: '.75rem' }, registrationStatusText);
    registrationStatusText.textContent = regStatus;
    regActionContainer.append(registrationStatusText);

    if (regAction) {
      const regActionButton = document.createElement('button');
      regActionButton.textContent = regAction;
      setStylesOnElement(this.theme.primaryButton, regActionButton);

      regActionButton.onclick = async () => {
        registrationStatusText.textContent = 'processing...';

        const result = await this.cventSdk.pickSession(sessionId);

        if (result.success) {
          // this message could be customized based on the `action` properties of the result
          // refresh the status text and button text that are displayed for this featured session
          const { regAction: updatedRegAction, regStatus: updatedRegStatus } = await this.getRegActionText(
            this.session
          );
          registrationStatusText.textContent = updatedRegStatus;
          regActionButton.textContent = updatedRegAction;
        } else {
          // this message could be customized based on the `failureReason` and `action` properties of result
          registrationStatusText.textContent = 'The registration action failed, please refresh and try again';
        }
      };
      regActionContainer.append(regActionButton);
    }
    return regActionContainer;
  }
}

const SessionStatus = {
  // registrant has already chosen this session
  SELECTED: 'SELECTED',
  // registrant is on the waitlist for the session
  WAITLISTED: 'WAITLISTED',
  // registrant has not selected this session, but can select it
  OPEN: 'OPEN',
  // registrant has not selected this session, there is no remaining capacity, but there is remaining waitlist capacity
  WAITLIST_AVAILABLE: 'WAITLIST_AVAILABLE',
  // this session is included in the registrants agenda automatically, either by admission item or session property
  // (distinguished via the `subStatus` returned from getSessionStatus)
  INCLUDED: 'INCLUDED',
  // session is registered already as part of a bundle selection
  BUNDLED: 'BUNDLED',
  // registrant has not selected this session and may not join the waitlist, either because the waitlist is full, or
  // there is no waitlist (distinguished via the `subStatus` returned from getSessionStatus)
  WAITLIST_UNAVAILABLE: 'WAITLIST_UNAVAILABLE',
  // the session is closed or cancelled
  CLOSED: 'CLOSED',
  // this session is not available for the registrant's currently selected admission item or registration type
  NOT_AVAILABLE: 'NOT_AVAILABLE',
  // no session in this event exists for the provided ID
  SESSION_DNE: 'SESSION_DNE',
  // no registration exists (in the current reg cart) for the provided ID
  REGISTRATION_DNE: 'REGISTRATION_DNE'
};

const IncludedSubStatus = {
  // session is included with the chosen admission item
  INCLUDED_BY_ADMISSION_ITEM: 'INCLUDED_BY_ADMISSION_ITEM',
  // session is included by the included/optional property of the session
  INCLUDED_BY_SESSION: 'INCLUDED_BY_SESSION'
};

const WaitlistSubStatus = {
  // waitlist is not enabled for the session
  NO_WAITLIST: 'NO_WAITLIST',
  // the waitlist is enabled but has no remaining capacity
  WAITLIST_FULL: 'WAITLIST_FULL'
};

const SessionActionFailureReason = {
  // there was not sufficient capacity to carry out the action, waitlist or session capacity became full
  CAPACITY_ERROR: 'CAPACITY_ERROR',
  // the session was closed, cancelled or otherwise not available
  AVAILABILITY_ERROR: 'AVAILABILITY_ERROR',
  // the error cause could not be determined
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
  // the session was in a non actionable status ("CLOSED", "NOT_AVAILABLE", "WAITLIST_UNAVAILABLE", etc.)
  NOT_ACTIONABLE: 'NOT_ACTIONABLE',
  // another registration action was processing when this action was attempted
  REG_ACTION_IN_PROGRESS: 'REG_ACTION_IN_PROGRESS'
};

/**
 * Applies an object contianing css styles to the provided element
 * The style objects provided in the `theme` constructor parameter for specific kinds of text (Header1, Secondary Button, etc.)
 * can be passed to `style` to match the styling of other text outside of your custom widget.
 * @param style  an object mapping css properties as keys to vthe desired values
 * @param element the HTML element to apply styles too
 */
const setStylesOnElement = (style, element) => {
  Object.assign(element.style, style);
  element.classList.add(...(style.customClasses || []));
};

const getApplicableChargePolicies = fee => {
  const now = Date.now();
  return (
    fee.chargePolicies
      .filter(chargePolicy => chargePolicy.isActive)
      // early bird pricing is effective through the day specified in effectiveUntil date string
      .filter(chargePolicy => new Date(chargePolicy.effectiveUntil).getTime() + 24 * 60 * 60 * 1000 > now)
      .sort(
        (chargePolicy1, chargePolicy2) =>
          new Date(chargePolicy1.effectiveUntil).getTime() - new Date(chargePolicy2.effectiveUntil).getTime()
      )
  );
};
