import { DocumentNode } from 'graphql';

import {
  QueryHookOptions,
  QueryDataOptions,
  QueryTuple,
  QueryResult,
} from '../../types/types';
import { QueryData } from '../../data/QueryData';
import { useDeepMemo } from './useDeepMemo';
import { OperationVariables } from '../../../core/types';
import { getApolloContext } from '../../context/ApolloContext';
import { requireReactLazily } from '../../react';

export function useBaseQuery<TData = any, TVariables = OperationVariables>(
  query: DocumentNode,
  options?: QueryHookOptions<TData, TVariables>,
  lazy = false
) {
  const React = requireReactLazily();
  const { useContext, useEffect, useReducer, useRef } = React;
  const context = useContext(getApolloContext());
  const [tick, forceUpdate] = useReducer(x => x + 1, 0);
  const updatedOptions = options ? { ...options, query } : { query };
  const isRendering = useRef(true);
  const isRenderScheduled = useRef(false);

  const queryDataRef = useRef<QueryData<TData, TVariables>>();
  const queryData =
    queryDataRef.current ||
    new QueryData<TData, TVariables>({
      options: updatedOptions as QueryDataOptions<TData, TVariables>,
      context,
      onNewData() {
        // When new data is received from the `QueryData` object, we want to
        // force a re-render to make sure the new data is displayed. We can't
        // force that re-render if we're already rendering however, so in that
        // case we'll defer triggering a re-render until we're inside an effect
        // hook.
        if (!queryData.ssrInitiated() && isRendering.current) {
          isRenderScheduled.current = true;
        } else {
          forceUpdate();
        }
      }
    });

  queryData.setOptions(updatedOptions);
  queryData.context = context;

  // SSR won't trigger the effect hook below that stores the current
  // `QueryData` instance for future renders, so we'll handle that here if
  // the current render is happening server side.
  if (queryData.ssrInitiated() && !queryDataRef.current) {
    queryDataRef.current = queryData;
  }

  // `onError` and `onCompleted` callback functions will not always have a
  // stable identity, so we'll exclude them from the memoization key to
  // prevent `afterExecute` from being triggered un-necessarily.
  const memo = {
    options: {
      ...updatedOptions,
      onError: undefined,
      onCompleted: undefined
    } as QueryHookOptions<TData, TVariables>,
    context,
    tick
  };

  const result = useDeepMemo(
    () => (lazy ? queryData.executeLazy() : queryData.execute()),
    memo
  );

  const queryResult = lazy
    ? (result as QueryTuple<TData, TVariables>)[1]
    : (result as QueryResult<TData, TVariables>);

  useEffect(() => {
    // We only need one instance of the `QueryData` class, so we'll store it
    // as a ref to make it available on subsequent renders.
    if (!queryDataRef.current) {
      queryDataRef.current = queryData;
    }

    // If `QueryData` requested a re-render to show new data while we were
    // in a render phase, let's handle the re-render here where it's safe to do
    // so.
    isRendering.current = false;
    if (isRenderScheduled.current) {
      isRenderScheduled.current = false;
      forceUpdate();
    }
  });

  useEffect(() => queryData.afterExecute({ queryResult, lazy }), [
    queryResult.loading,
    queryResult.networkStatus,
    queryResult.error,
    queryResult.data
  ]);

  useEffect(() => {
    return () => queryData.cleanup();
  }, []);

  return result;
}
