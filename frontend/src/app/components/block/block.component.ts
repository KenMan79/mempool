import { Component, OnInit, OnDestroy } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';
import { ElectrsApiService } from '../../services/electrs-api.service';
import { switchMap, tap, debounceTime, catchError, map } from 'rxjs/operators';
import { Block, Transaction, Vout } from '../../interfaces/electrs.interface';
import { Observable, of, Subscription } from 'rxjs';
import { StateService } from '../../services/state.service';
import { SeoService } from 'src/app/services/seo.service';
import { WebsocketService } from 'src/app/services/websocket.service';

@Component({
  selector: 'app-block',
  templateUrl: './block.component.html',
  styleUrls: ['./block.component.scss']
})
export class BlockComponent implements OnInit, OnDestroy {
  network = '';
  block: Block;
  blockHeight: number;
  blockHash: string;
  isLoadingBlock = true;
  latestBlock: Block;
  transactions: Transaction[];
  isLoadingTransactions = true;
  error: any;
  blockSubsidy: number;
  subscription: Subscription;
  fees: number;
  paginationMaxSize: number;
  coinbaseTx: Transaction;
  page = 1;
  itemsPerPage: number;
  txsLoadingStatus$: Observable<number>;
  showDetails = false;

  constructor(
    private route: ActivatedRoute,
    private location: Location,
    private router: Router,
    private electrsApiService: ElectrsApiService,
    private stateService: StateService,
    private seoService: SeoService,
    private websocketService: WebsocketService,
  ) { }

  ngOnInit() {
    this.websocketService.want(['blocks', 'mempool-blocks']);
    this.paginationMaxSize = window.matchMedia('(max-width: 700px)').matches ? 3 : 5;
    this.network = this.stateService.network;
    this.itemsPerPage = this.stateService.env.ITEMS_PER_PAGE;

    this.txsLoadingStatus$ = this.route.paramMap
      .pipe(
        switchMap(() => this.stateService.loadingIndicators$),
        map((indicators) => indicators['blocktxs-' + this.blockHash] !== undefined ? indicators['blocktxs-' + this.blockHash] : 0)
      );

    this.subscription = this.route.paramMap
    .pipe(
      switchMap((params: ParamMap) => {
        const blockHash: string = params.get('id') || '';
        this.block = undefined;
        this.page = 1;
        this.coinbaseTx = undefined;
        this.error = undefined;
        this.fees = undefined;
        this.stateService.markBlock$.next({});

        if (history.state.data && history.state.data.blockHeight) {
          this.blockHeight = history.state.data.blockHeight;
        }

        let isBlockHeight = false;
        if (/^[0-9]+$/.test(blockHash)) {
          isBlockHeight = true;
        } else {
          this.blockHash = blockHash;
        }
        document.body.scrollTo(0, 0);

        if (history.state.data && history.state.data.block) {
          this.blockHeight = history.state.data.block.height;
          return of(history.state.data.block);
        } else {
          this.isLoadingBlock = true;

          if (isBlockHeight) {
            return this.electrsApiService.getBlockHashFromHeight$(parseInt(blockHash, 10))
              .pipe(
                switchMap((hash) => {
                  this.blockHash = hash;
                  this.location.replaceState(
                    this.router.createUrlTree([(this.network ? '/' + this.network : '') + '/block/', hash]).toString()
                  );
                  return this.electrsApiService.getBlock$(hash);
                })
              );
          }
          return this.electrsApiService.getBlock$(blockHash);
        }
      }),
      tap((block: Block) => {
        this.block = block;
        this.blockHeight = block.height;
        this.seoService.setTitle($localize`:@@block.component.browser-title:Block ${block.height}:BLOCK_HEIGHT:: ${block.id}:BLOCK_ID:`);
        this.isLoadingBlock = false;
        if (block.coinbaseTx) {
          this.coinbaseTx = block.coinbaseTx;
        }
        this.setBlockSubsidy();
        if (block.reward !== undefined) {
          this.fees = block.reward / 100000000 - this.blockSubsidy;
        }
        this.stateService.markBlock$.next({ blockHeight: this.blockHeight });
        this.isLoadingTransactions = true;
        this.transactions = null;
      }),
      debounceTime(300),
      switchMap((block) => this.electrsApiService.getBlockTransactions$(block.id)
        .pipe(
          catchError((err) => {
            console.log(err);
            return of([]);
        }))
      ),
    )
    .subscribe((transactions: Transaction[]) => {
      if (this.fees === undefined && transactions[0]) {
        this.fees = transactions[0].vout.reduce((acc: number, curr: Vout) => acc + curr.value, 0) / 100000000 - this.blockSubsidy;
      }
      if (!this.coinbaseTx && transactions[0]) {
        this.coinbaseTx = transactions[0];
      }
      this.transactions = transactions;
      this.isLoadingTransactions = false;
    },
    (error) => {
      this.error = error;
      this.isLoadingBlock = false;
    });

    this.stateService.blocks$
      .subscribe(([block]) => this.latestBlock = block);

    this.stateService.networkChanged$
      .subscribe((network) => this.network = network);

    this.route.queryParams.subscribe((params) => {
      if (params.showDetails === 'true') {
        this.showDetails = true;
      } else {
        this.showDetails = false;
      }
    });
  }

  ngOnDestroy() {
    this.stateService.markBlock$.next({});
    this.subscription.unsubscribe();
  }

  setBlockSubsidy() {
    if (this.network === 'liquid') {
      this.blockSubsidy = 0;
      return;
    }
    this.blockSubsidy = 50;
    let halvenings = Math.floor(this.block.height / 210000);
    while (halvenings > 0) {
      this.blockSubsidy = this.blockSubsidy / 2;
      halvenings--;
    }
  }

  pageChange(page: number) {
    const start = (page - 1) * this.itemsPerPage;
    this.isLoadingTransactions = true;
    this.transactions = null;

    this.electrsApiService.getBlockTransactions$(this.block.id, start)
     .subscribe((transactions) => {
        this.transactions = transactions;
        this.isLoadingTransactions = false;
      });
  }

  toggleShowDetails() {
    if (this.showDetails) {
      this.showDetails = false;
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { showDetails: false },
        queryParamsHandling: 'merge',
        fragment: 'block'
      });
    } else {
      this.showDetails = true;
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { showDetails: true },
        queryParamsHandling: 'merge',
        fragment: 'details'
      });
    }
  }

  hasTaproot(version: number): boolean {
    const versionBit = 2; // Taproot
    return (Number(version) & (1 << versionBit)) === (1 << versionBit);
  }

  displayTaprootStatus(): boolean {
    if (this.stateService.network !== '') {
      return false;
    }
    return this.block && this.block.height > 681393 && (new Date().getTime() / 1000) < 1628640000;
  }
}
