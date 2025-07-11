import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Users, DollarSign, Link2, TrendingUp, Plus, Copy, CheckCircle } from 'lucide-react';

interface Affiliate {
  id: string;
  affiliate_code: string;
  status: 'pending' | 'active' | 'suspended' | 'rejected';
  commission_rate: number;
  total_earnings: number;
  total_referrals: number;
  profiles: {
    full_name: string;
    email: string;
    phone?: string;
  };
  created_at: string;
}

export default function AffiliateManagement() {
  const [affiliates, setAffiliates] = useState<Affiliate[]>([]);
  const [myAffiliate, setMyAffiliate] = useState<Affiliate | null>(null);
  const [loading, setLoading] = useState(true);
  const [newAffiliateForm, setNewAffiliateForm] = useState({
    email: '',
    commission_rate: '10'
  });
  
  const { profile } = useAuth();
  const { toast } = useToast();

  useEffect(() => {
    fetchAffiliates();
    fetchMyAffiliateData();
  }, [profile]);

  const fetchAffiliates = async () => {
    if (!profile) return;

    try {
      let query = supabase
        .from('affiliates')
        .select(`
          *,
          profiles (full_name, email, phone)
        `);

      // If user is master affiliate, show their recruited affiliates
      if (profile.role === 'master_affiliate') {
        const { data: myAffiliateData } = await supabase
          .from('affiliates')
          .select('id')
          .eq('user_id', profile.id)
          .single();

        if (myAffiliateData) {
          query = query.eq('master_affiliate_id', myAffiliateData.id);
        }
      }
      // If admin, show all affiliates
      else if (profile.role === 'admin') {
        // Show all affiliates
      }

      const { data, error } = await query;
      
      if (error) throw error;
      setAffiliates(data || []);
    } catch (error) {
      console.error('Error fetching affiliates:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchMyAffiliateData = async () => {
    if (!profile) return;

    try {
      const { data, error } = await supabase
        .from('affiliates')
        .select(`
          *,
          profiles (full_name, email, phone)
        `)
        .eq('user_id', profile.id)
        .single();

      if (error && error.code !== 'PGRST116') throw error;
      setMyAffiliate(data);
    } catch (error) {
      console.error('Error fetching my affiliate data:', error);
    }
  };

  const createAffiliate = async () => {
    if (!profile || !newAffiliateForm.email) return;

    try {
      // Get my affiliate ID for master_affiliate_id
      const { data: myAffiliateData } = await supabase
        .from('affiliates')
        .select('id')
        .eq('user_id', profile.id)
        .single();

      // Generate affiliate code
      const { data: codeData, error: codeError } = await supabase
        .rpc('generate_affiliate_code');

      if (codeError) throw codeError;

      // Find user by email
      const { data: userData, error: userError } = await supabase
        .from('profiles')
        .select('id')
        .eq('email', newAffiliateForm.email)
        .single();

      if (userError) {
        toast({
          title: "Error",
          description: "User dengan email tersebut tidak ditemukan",
          variant: "destructive",
        });
        return;
      }

      // Create affiliate
      const { error } = await supabase
        .from('affiliates')
        .insert({
          user_id: userData.id,
          affiliate_code: codeData,
          master_affiliate_id: myAffiliateData?.id,
          commission_rate: parseFloat(newAffiliateForm.commission_rate),
          status: 'pending'
        });

      if (error) throw error;

      toast({
        title: "Berhasil",
        description: "Affiliate baru berhasil dibuat",
      });

      setNewAffiliateForm({ email: '', commission_rate: '10' });
      fetchAffiliates();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const updateAffiliateStatus = async (affiliateId: string, status: 'pending' | 'active' | 'suspended' | 'rejected') => {
    try {
      const { error } = await supabase
        .from('affiliates')
        .update({ status })
        .eq('id', affiliateId);

      if (error) throw error;

      toast({
        title: "Berhasil",
        description: "Status affiliate berhasil diupdate",
      });

      fetchAffiliates();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const becomeAffiliate = async () => {
    if (!profile) return;

    try {
      const { data: codeData, error: codeError } = await supabase
        .rpc('generate_affiliate_code');

      if (codeError) throw codeError;

      const { error } = await supabase
        .from('affiliates')
        .insert({
          user_id: profile.id,
          affiliate_code: codeData,
          commission_rate: 10.00,
          status: 'pending'
        });

      if (error) throw error;

      toast({
        title: "Berhasil",
        description: "Aplikasi affiliate berhasil dikirim",
      });

      fetchMyAffiliateData();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const copyAffiliateLink = (code: string) => {
    const link = `${window.location.origin}/?ref=${code}`;
    navigator.clipboard.writeText(link);
    toast({
      title: "Berhasil",
      description: "Link affiliate berhasil disalin",
    });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-success';
      case 'pending': return 'bg-warning';
      case 'suspended': return 'bg-destructive';
      case 'rejected': return 'bg-muted';
      default: return 'bg-muted';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Manajemen Affiliate</h1>
          <p className="text-muted-foreground">Kelola program affiliate dan rekrut mitra</p>
        </div>
      </div>

      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="affiliates">Daftar Affiliate</TabsTrigger>
          {(profile?.role === 'master_affiliate' || profile?.role === 'admin') && (
            <TabsTrigger value="recruit">Rekrut Affiliate</TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          {/* My Affiliate Status */}
          {!myAffiliate && profile?.role === 'customer' && (
            <Card>
              <CardHeader>
                <CardTitle>Bergabung sebagai Affiliate</CardTitle>
                <CardDescription>
                  Mulai earning dengan menjadi affiliate partner kami
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button onClick={becomeAffiliate}>
                  <Plus className="mr-2 h-4 w-4" />
                  Daftar sebagai Affiliate
                </Button>
              </CardContent>
            </Card>
          )}

          {myAffiliate && (
            <Card>
              <CardHeader>
                <CardTitle>Status Affiliate Anda</CardTitle>
                <CardDescription>
                  Informasi dan performa affiliate Anda
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-4">
                  <Badge className={getStatusColor(myAffiliate.status)}>
                    {myAffiliate.status}
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    Kode: {myAffiliate.affiliate_code}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => copyAffiliateLink(myAffiliate.affiliate_code)}
                  >
                    <Copy className="mr-2 h-4 w-4" />
                    Copy Link
                  </Button>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="text-center p-4 bg-muted/50 rounded-lg">
                    <DollarSign className="h-8 w-8 mx-auto mb-2 text-primary" />
                    <div className="text-2xl font-bold">Rp {myAffiliate.total_earnings.toLocaleString()}</div>
                    <div className="text-sm text-muted-foreground">Total Earnings</div>
                  </div>
                  <div className="text-center p-4 bg-muted/50 rounded-lg">
                    <Users className="h-8 w-8 mx-auto mb-2 text-primary" />
                    <div className="text-2xl font-bold">{myAffiliate.total_referrals}</div>
                    <div className="text-sm text-muted-foreground">Referrals</div>
                  </div>
                  <div className="text-center p-4 bg-muted/50 rounded-lg">
                    <TrendingUp className="h-8 w-8 mx-auto mb-2 text-primary" />
                    <div className="text-2xl font-bold">{myAffiliate.commission_rate}%</div>
                    <div className="text-sm text-muted-foreground">Commission Rate</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Statistics Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center">
                  <Users className="h-8 w-8 text-primary" />
                  <div className="ml-4">
                    <p className="text-2xl font-bold">{affiliates.length}</p>
                    <p className="text-muted-foreground">Total Affiliates</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center">
                  <CheckCircle className="h-8 w-8 text-success" />
                  <div className="ml-4">
                    <p className="text-2xl font-bold">
                      {affiliates.filter(a => a.status === 'active').length}
                    </p>
                    <p className="text-muted-foreground">Active Affiliates</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center">
                  <DollarSign className="h-8 w-8 text-primary" />
                  <div className="ml-4">
                    <p className="text-2xl font-bold">
                      Rp {affiliates.reduce((sum, a) => sum + a.total_earnings, 0).toLocaleString()}
                    </p>
                    <p className="text-muted-foreground">Total Payouts</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center">
                  <Link2 className="h-8 w-8 text-primary" />
                  <div className="ml-4">
                    <p className="text-2xl font-bold">
                      {affiliates.reduce((sum, a) => sum + a.total_referrals, 0)}
                    </p>
                    <p className="text-muted-foreground">Total Referrals</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="affiliates">
          <Card>
            <CardHeader>
              <CardTitle>Daftar Affiliate</CardTitle>
              <CardDescription>
                Kelola dan monitor performa affiliate
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nama</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Kode</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Commission</TableHead>
                    <TableHead>Earnings</TableHead>
                    <TableHead>Referrals</TableHead>
                    <TableHead>Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {affiliates.map((affiliate) => (
                    <TableRow key={affiliate.id}>
                      <TableCell>{affiliate.profiles?.full_name || 'N/A'}</TableCell>
                      <TableCell>{affiliate.profiles?.email}</TableCell>
                      <TableCell className="font-mono">{affiliate.affiliate_code}</TableCell>
                      <TableCell>
                        <Badge className={getStatusColor(affiliate.status)}>
                          {affiliate.status}
                        </Badge>
                      </TableCell>
                      <TableCell>{affiliate.commission_rate}%</TableCell>
                      <TableCell>Rp {affiliate.total_earnings.toLocaleString()}</TableCell>
                      <TableCell>{affiliate.total_referrals}</TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          {affiliate.status === 'pending' && (
                            <>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => updateAffiliateStatus(affiliate.id, 'active')}
                              >
                                Approve
                              </Button>
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => updateAffiliateStatus(affiliate.id, 'rejected')}
                              >
                                Reject
                              </Button>
                            </>
                          )}
                          {affiliate.status === 'active' && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => updateAffiliateStatus(affiliate.id, 'suspended')}
                            >
                              Suspend
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {(profile?.role === 'master_affiliate' || profile?.role === 'admin') && (
          <TabsContent value="recruit">
            <Card>
              <CardHeader>
                <CardTitle>Rekrut Affiliate Baru</CardTitle>
                <CardDescription>
                  Undang dan daftarkan affiliate baru ke program Anda
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="email">Email Calon Affiliate</Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="email@example.com"
                      value={newAffiliateForm.email}
                      onChange={(e) => setNewAffiliateForm({ ...newAffiliateForm, email: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="commission">Commission Rate (%)</Label>
                    <Input
                      id="commission"
                      type="number"
                      placeholder="10"
                      value={newAffiliateForm.commission_rate}
                      onChange={(e) => setNewAffiliateForm({ ...newAffiliateForm, commission_rate: e.target.value })}
                    />
                  </div>
                </div>
                <Button onClick={createAffiliate}>
                  <Plus className="mr-2 h-4 w-4" />
                  Tambah Affiliate
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}