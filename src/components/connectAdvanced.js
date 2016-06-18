import hoistStatics from 'hoist-non-react-statics'
import invariant from 'invariant'
import { Component, PropTypes, createElement } from 'react'

import defaultBuildSelector from '../utils/buildSelector'
import storeShape from '../utils/storeShape'

let hotReloadingVersion = 0
export default function connectAdvanced(
  /*
    selectorFactory is a func is responsible for returning the selector function used to compute new
    props from state, props, and dispatch. For example:

      export default connectAdvanced(() => (state, props, dispatch) => ({
        thing: state.things[props.thingId],
        saveThing: fields => dispatch(actionCreators.saveThing(props.thingId, fields)),
      }))(YourComponent)
  */
  selectorFactory,
  // options object:
  {
    // this is the function that invokes the selectorFactory and enhances it with a few important
    // behaviors. you probably want to leave this alone unless you've read and understand the source
    // for components/connectAdvanced.js and utils/buildSelector.js, then maybe you can use this as
    // an injection point for custom behavior, for example hooking in some custom devtools.
    buildSelector = defaultBuildSelector,

    // the func used to compute this HOC's displayName from the wrapped component's displayName.
    // probably overridden by wrapper functions such as connect()
    getDisplayName = name => `ConnectAdvanced(${name})`,

    // shown in error messages
    // probably overridden by wrapper functions such as connect()
    methodName = 'connectAdvanced',

    // if true, shouldComponentUpdate will only be true of the selector recomputes for nextProps.
    // if false, shouldComponentUpdate will always be true.
    pure = true,

    // if defined, the name of the property passed to the wrapped element indicating the number of
    // recomputations since it was mounted. useful for watching in react devtools for unnecessary
    // re-renders.
    recomputationsProp = undefined,

    // if true, the selector receieves the current store state as the first arg, and this HOC
    // subscribes to store changes during componentDidMount. if false, null is passed as the first
    // arg of selector and store.subscribe() is never called.
    shouldUseState = true,

    // the key of props/context to get the store
    storeKey = 'store',

    // if true, the wrapped element is exposed by this HOC via the getWrappedInstance() function.
    withRef = false
  } = {}
) {
  const subscribeKey = storeKey + 'Subscribe'
  const version = hotReloadingVersion++
  return function wrapWithConnect(WrappedComponent) {
    class Connect extends Component {
      constructor(props, context) {
        super(props, context)
        this.version = version
        this.state = {}
        this.store = this.props[storeKey] || this.context[storeKey]
        this.childSubs = {}

        invariant(this.store,
          `Could not find "${storeKey}" in either the context or ` +
          `props of "${Connect.displayName}". ` +
          `Either wrap the root component in a <Provider>, ` +
          `or explicitly pass "${storeKey}" as a prop to "${Connect.displayName}".`
        )

        this.initSelector()
      }

      getChildContext() {
        return {
          [subscribeKey]: listener => this.trySubscribe(listener)
        }
      }

      componentDidMount() {
        this.trySubscribe()

        // check for recomputations that happened after this component has rendered, such as
        // when a child component dispatches an action in its componentWillMount
        if (this.hasUnrenderedRecomputations(this.props)) this.forceUpdate()
      }

      shouldComponentUpdate(nextProps) {
        return !pure || this.hasUnrenderedRecomputations(nextProps)
      }

      componentWillUnmount() {
        this.tryUnsubscribe()
        this.store = null
        this.selector = null
      }

      initSelector() {
        this.recomputationsDuringLastRender = null

        this.selector = buildSelector({
          displayName: Connect.displayName,
          dispatch: this.store.dispatch,
          getState: shouldUseState ? this.store.getState : (() => null),
          ref: withRef ? (ref => { this.wrappedInstance = ref }) : undefined,
          selectorFactory,
          recomputationsProp,
          methodName,
          pure,
          shouldUseState,
          storeKey,
          withRef
        })
      }

      hasUnrenderedRecomputations(props) {
        return this.recomputationsDuringLastRender !== this.selector(props).recomputations
      }

      trySubscribe(childListener) {
        const subscribe = this.context[subscribeKey] || this.store.subscribe

        if ((shouldUseState || childListener) && !this.isSubscribed()) {
          this.unsubscribe = subscribe(() => {
            if (this.unsubscribe && this.shouldComponentUpdate(this.props)) {
              // invoke setState() instead of forceUpdate() so that shouldComponentUpdate()
              // gets a chance to prevent unneeded re-renders
              this.setState({}, () => {
                const keys = Object.keys(this.childSubs)
                for (let i = 0; i < keys.length; i++) {
                  this.childSubs[keys[i]].listener()
                }
              })
            }
          })
        }

        if (childListener) {
          //const unsubscribe = subscribe(childListener)
          const id = this.lastChildSubId++
          this.childSubs[id] = { listener: childListener }

          return () => {
            if (this.childSubs[id]) {
              //this.childSubs[id].unsubscribe()
              delete this.childSubs[id]
            }
          }
        }

        return undefined
      }

      tryUnsubscribe() {
        if (this.unsubscribe) this.unsubscribe()
        this.unsubscribe = null
        this.childSubs = {}
      }

      getWrappedInstance() {
        invariant(withRef,
          `To access the wrapped instance, you need to specify ` +
          `{ withRef: true } in the options argument of the ${methodName}() call.`
        )
        return this.wrappedInstance
      }

      isSubscribed() {
        return typeof this.unsubscribe === 'function'
      }

      render() {
        const { props, recomputations } = this.selector(this.props)
        this.recomputationsDuringLastRender = recomputations
        return createElement(WrappedComponent, props)
      }
    }

    const wrappedComponentName = WrappedComponent.displayName
      || WrappedComponent.name
      || 'Component'

    Connect.displayName = getDisplayName(wrappedComponentName)
    Connect.WrappedComponent = WrappedComponent
    Connect.propTypes = { [storeKey]: storeShape }

    Connect.contextTypes = {
      [storeKey]: storeShape,
      [subscribeKey]: PropTypes.func
    }
    Connect.childContextTypes = {
      [subscribeKey]: PropTypes.func
    }


    if (process.env.NODE_ENV !== 'production') {
      Connect.prototype.componentWillUpdate = function componentWillUpdate() {
        // We are hot reloading!
        if (this.version !== version) {
          this.version = version
          this.initSelector()
          this.tryUnsubscribe()
          this.trySubscribe()
        }
      }
    }

    return hoistStatics(Connect, WrappedComponent)
  }
}
